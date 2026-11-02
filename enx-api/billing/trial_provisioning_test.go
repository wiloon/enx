package billing

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"enx-api/billing/credit"
	"enx-api/enx"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

const provisionTrial = 100

// installNewUserHook installs h as enx's new-user hook for this test.
func installNewUserHook(t *testing.T, h enx.NewUserHook) {
	t.Helper()
	enx.SetNewUserHook(h)
	t.Cleanup(func() { enx.SetNewUserHook(nil) })
}

// cleanupClerkUser removes the user provisioned for clerkUserID and its
// trial and ledger rows.
func cleanupClerkUser(t *testing.T, clerkUserID string) {
	t.Helper()
	t.Cleanup(func() {
		var ids []string
		if err := sqlitex.DB.Raw(`SELECT id FROM users WHERE clerk_user_id = ?`, clerkUserID).Scan(&ids).Error; err != nil {
			t.Errorf("find %s: %v", clerkUserID, err)
		}
		for _, id := range ids {
			for _, table := range []string{"credit_transactions", "credit_accounts", "trial_grants"} {
				if err := sqlitex.DB.Exec("DELETE FROM "+table+" WHERE user_id = ?", id).Error; err != nil {
					t.Errorf("clean up %s: %v", table, err)
				}
			}
		}
		if err := sqlitex.DB.Exec(`DELETE FROM users WHERE clerk_user_id = ?`, clerkUserID).Error; err != nil {
			t.Errorf("clean up users: %v", err)
		}
	})
}

func trialGrantCounting(observed *atomic.Int32) TrialGrant {
	return TrialGrant{Amount: provisionTrial, TTL: 7 * 24 * time.Hour, EmailHMAC: fakeHMAC,
		Observe: func() { observed.Add(1) }}
}

// pausedHook waits for release before delegating to the real grant.
type pausedHook struct {
	grant   TrialGrant
	release chan struct{}
}

func (h pausedHook) NewUser(ctx context.Context, tx *gorm.DB, userID, email string) (func(), error) {
	<-h.release
	return h.grant.NewUser(ctx, tx, userID, email)
}

type provisionedTrial struct {
	userID  string
	balance int64
	err     error
}

// #596: every overlapping first request of a new user reads the full trial
// as soon as its own sign-in returns.
func TestConcurrentFirstRequestsAllSeeTheTrial(t *testing.T) {
	const clerkID = "user_concurrent_trial"
	cleanupClerkUser(t, clerkID)
	var observed atomic.Int32
	release := make(chan struct{})
	installNewUserHook(t, pausedHook{grant: trialGrantCounting(&observed), release: release})
	p := enx.ClerkProfile{Email: "concurrent-trial@example.com"}

	const callers = 4
	results := make(chan provisionedTrial, callers)
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			u, err := enx.GetOrCreateClerkUser(clerkID, p, time.Hour)
			if err != nil {
				results <- provisionedTrial{err: err}
				return
			}
			balance, _, err := credit.Trial(context.Background(), u.Id)
			results <- provisionedTrial{userID: u.Id, balance: balance, err: err}
		}()
	}
	time.AfterFunc(300*time.Millisecond, func() { close(release) })
	wg.Wait()
	close(results)

	var userID string
	for r := range results {
		if r.err != nil {
			t.Fatalf("caller failed: %v", r.err)
		}
		if userID == "" {
			userID = r.userID
		}
		if r.userID != userID || r.balance != provisionTrial {
			t.Errorf("caller got user %s with trial %d, want user %s with %d", r.userID, r.balance, userID, provisionTrial)
		}
	}
	var grants int64
	if err := sqlitex.DB.Model(&sqlitex.CreditTransaction{}).
		Where("user_id = ? AND type = ?", userID, credit.TypeGrantTrial).Count(&grants).Error; err != nil {
		t.Fatal(err)
	}
	if grants != 1 || observed.Load() != 1 {
		t.Fatalf("%d GRANT_TRIAL rows and %d observed grants, want 1 and 1", grants, observed.Load())
	}
}

// ADR-048: a failed grant is logged and never fails sign-in, and it leaves
// none of its writes behind.
func TestFailedTrialGrantLeavesNoPartialGrant(t *testing.T) {
	const clerkID = "user_failed_trial"
	cleanupClerkUser(t, clerkID)
	if err := sqlitex.DB.Exec(`CREATE TRIGGER refuse_ledger BEFORE INSERT ON credit_transactions BEGIN SELECT RAISE(ABORT, 'ledger down'); END`).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := sqlitex.DB.Exec(`DROP TRIGGER refuse_ledger`).Error; err != nil {
			t.Errorf("drop trigger: %v", err)
		}
	})
	var observed atomic.Int32
	installNewUserHook(t, trialGrantCounting(&observed))

	u, err := enx.GetOrCreateClerkUser(clerkID, enx.ClerkProfile{Email: "failed-trial@example.com"}, time.Hour)
	if err != nil {
		t.Fatalf("a failed grant failed the sign-in: %v", err)
	}
	if stored := enx.GetUserByClerkUserID(clerkID); stored.Id != u.Id {
		t.Fatalf("stored user %q, want %q", stored.Id, u.Id)
	}
	var trialGrants, ledger int64
	if err := sqlitex.DB.Model(&sqlitex.TrialGrant{}).Where("user_id = ?", u.Id).Count(&trialGrants).Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Model(&sqlitex.CreditTransaction{}).Where("user_id = ?", u.Id).Count(&ledger).Error; err != nil {
		t.Fatal(err)
	}
	balance, _, err := credit.Trial(context.Background(), u.Id)
	if err != nil {
		t.Fatal(err)
	}
	if trialGrants != 0 || ledger != 0 || balance != 0 {
		t.Fatalf("trial_grants=%d ledger=%d trial=%d, want no grant left behind", trialGrants, ledger, balance)
	}
	if observed.Load() != 0 {
		t.Fatalf("observed %d grants, want none", observed.Load())
	}
}

// failingCommitHook makes the real grant, then rolls the transaction back
// underneath enx so the outer commit fails.
type failingCommitHook struct{ grant TrialGrant }

func (h failingCommitHook) NewUser(ctx context.Context, tx *gorm.DB, userID, email string) (func(), error) {
	afterCommit, err := h.grant.NewUser(ctx, tx, userID, email)
	if err != nil {
		return nil, err
	}
	if err := tx.Statement.ConnPool.(gorm.TxCommitter).Rollback(); err != nil {
		return nil, err
	}
	return afterCommit, nil
}

// enx_trial_grants_total counts committed grants only.
func TestTrialGrantIsNotCountedWhenProvisioningFailsToCommit(t *testing.T) {
	const clerkID = "user_uncommitted_trial"
	cleanupClerkUser(t, clerkID)
	var observed atomic.Int32
	installNewUserHook(t, failingCommitHook{grant: trialGrantCounting(&observed)})

	got, err := enx.GetOrCreateClerkUser(clerkID, enx.ClerkProfile{Email: "uncommitted-trial@example.com"}, time.Hour)
	if !errors.Is(err, sql.ErrTxDone) || got != nil {
		t.Fatalf("got user %+v, err %v; want no user and sql.ErrTxDone", got, err)
	}
	if observed.Load() != 0 {
		t.Fatalf("observed %d grants for a provisioning that never committed", observed.Load())
	}
	if stored := enx.GetUserByClerkUserID(clerkID); stored.Id != "" {
		t.Fatalf("user %s stored, want none", stored.Id)
	}
}
