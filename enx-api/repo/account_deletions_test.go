package repo

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"enx-api/account"
	"enx-api/utils/sqlitex"
)

func gateStates(t *testing.T, userID string) []string {
	t.Helper()
	var states []string
	if err := sqlitex.DB.Raw("SELECT state FROM account_deletion_gates WHERE user_id = ?", userID).Scan(&states).Error; err != nil {
		t.Fatal(err)
	}
	return states
}

func TestAccountDeletionsReleaseLiftsTheGateAndLeavesTheAccountAndTrialGrant(t *testing.T) {
	newAccountDB(t)
	seedAccount(t, "alice", "alice@example.com")
	grant := sqlitex.TrialGrant{EmailHmac: "hmac_alice", UserId: "alice", GrantedAt: 123}
	if err := sqlitex.DB.Create(&grant).Error; err != nil {
		t.Fatal(err)
	}
	ctx, now := context.Background(), time.Now()
	deletions := AccountDeletions{}

	a, err := deletions.Acquire(ctx, account.User{ID: "alice"}, account.DeleteOptions{ResetTrial: true}, now)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	if err := deletions.Release(ctx, a, now); err != nil {
		t.Fatalf("Release: %v", err)
	}

	if states := gateStates(t, "alice"); len(states) != 0 {
		t.Errorf("gate states = %v, want the gate lifted", states)
	}
	if n := countRows(t, "account_deletion_attempts", "user_id", "alice"); n != 0 {
		t.Errorf("account_deletion_attempts: %d row(s), want none", n)
	}
	if n := countRows(t, "users", "id", "alice"); n != 1 {
		t.Errorf("users: %d row(s) of alice, want the account kept", n)
	}
	var after sqlitex.TrialGrant
	if err := sqlitex.DB.First(&after, "email_hmac = ?", grant.EmailHmac).Error; err != nil || after != grant {
		t.Errorf("trial grant = %+v, %v; want %+v unchanged", after, err, grant)
	}
}

// ADR-062 Decision 3: an email keeps its one trial across a deletion unless
// the admin's deletion resets the trial.
func TestAccountDeletionsPrepareRecordsTheTrialGrantUnlessTheTrialIsReset(t *testing.T) {
	earlier := sqlitex.TrialGrant{EmailHmac: "hmac_alice", UserId: "older-alice", GrantedAt: 123}
	for _, tc := range []struct {
		name     string
		reset    bool
		existing *sqlitex.TrialGrant
		want     []sqlitex.TrialGrant
	}{
		{"recorded", false, nil, []sqlitex.TrialGrant{{EmailHmac: "hmac_alice", UserId: "alice"}}},
		{"earlier record kept", false, &earlier, []sqlitex.TrialGrant{earlier}},
		{"reset clears the record", true, &earlier, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			newAccountDB(t)
			seedAccount(t, "alice", "alice@example.com")
			if tc.existing != nil {
				if err := sqlitex.DB.Create(tc.existing).Error; err != nil {
					t.Fatal(err)
				}
			}
			ctx, now := context.Background(), time.Now()
			deletions := AccountDeletions{}
			a, err := deletions.Acquire(ctx, account.User{ID: "alice"}, account.DeleteOptions{ResetTrial: tc.reset}, now)
			if err != nil {
				t.Fatalf("Acquire: %v", err)
			}

			if err := deletions.Prepare(ctx, a, "hmac_alice", now); err != nil {
				t.Fatalf("Prepare: %v", err)
			}

			var grants []sqlitex.TrialGrant
			if err := sqlitex.DB.Find(&grants).Error; err != nil {
				t.Fatal(err)
			}
			for i := range grants {
				if tc.existing == nil {
					grants[i].GrantedAt = 0
				}
			}
			if len(grants) != len(tc.want) || (len(grants) == 1 && grants[0] != tc.want[0]) {
				t.Fatalf("trial grants = %+v, want %+v", grants, tc.want)
			}
		})
	}
}

type attemptRow struct {
	Owner      string
	Phase      string
	ResetTrial bool
}

func attemptOf(t *testing.T, userID string) attemptRow {
	t.Helper()
	var rows []attemptRow
	if err := sqlitex.DB.Raw("SELECT owner, phase, reset_trial FROM account_deletion_attempts WHERE user_id = ?", userID).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("account_deletion_attempts: %d row(s) of %s, want one", len(rows), userID)
	}
	return rows[0]
}

func TestAccountDeletionsAcquireRefusesWhileAnotherAttemptHoldsTheLease(t *testing.T) {
	newAccountDB(t)
	seedAccount(t, "alice", "alice@example.com")
	ctx, now := context.Background(), time.Now()
	deletions := AccountDeletions{}
	first, err := deletions.Acquire(ctx, account.User{ID: "alice"}, account.DeleteOptions{}, now)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}

	if _, err := deletions.Acquire(ctx, account.User{ID: "alice"}, account.DeleteOptions{}, now.Add(30*time.Second)); !errors.Is(err, account.ErrDeletionInProgress) {
		t.Fatalf("second Acquire = %v, want ErrDeletionInProgress", err)
	}
	if got := attemptOf(t, "alice"); got.Owner != first.Owner {
		t.Errorf("owner = %s, want the first attempt's %s", got.Owner, first.Owner)
	}
}

// A recovering request takes an expired attempt over as it stands: once
// Clerk may have been called it must finish, and with the original intent.
func TestAccountDeletionsTakeoverKeepsThePhaseAndTheOriginalResetIntent(t *testing.T) {
	newAccountDB(t)
	seedAccount(t, "alice", "alice@example.com")
	ctx, now := context.Background(), time.Now()
	deletions := AccountDeletions{}
	first, err := deletions.Acquire(ctx, account.User{ID: "alice"}, account.DeleteOptions{ResetTrial: true}, now)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	if err := deletions.Prepare(ctx, first, "hmac_alice", now); err != nil {
		t.Fatalf("Prepare: %v", err)
	}

	later := now.Add(2 * time.Minute)
	second, err := deletions.Acquire(ctx, account.User{ID: "alice"}, account.DeleteOptions{ResetTrial: false}, later)
	if err != nil {
		t.Fatalf("takeover Acquire: %v", err)
	}

	if !second.Irreversible || second.Owner == first.Owner {
		t.Errorf("takeover = %+v, want an irreversible attempt under a new owner", second)
	}
	if got := attemptOf(t, "alice"); got != (attemptRow{Owner: second.Owner, Phase: "irreversible", ResetTrial: true}) {
		t.Errorf("attempt = %+v, want irreversible with the original reset intent", got)
	}
	if err := deletions.Complete(ctx, second, later); err != nil {
		t.Fatalf("Complete by the new owner: %v", err)
	}
}

// An owner whose lease expired, whether or not another request took the
// attempt over, may no longer move it.
func TestAccountDeletionsRefuseAStaleOwner(t *testing.T) {
	deletions := AccountDeletions{}
	ops := map[string]struct {
		prepared bool
		call     func(context.Context, account.DeletionAttempt, time.Time) error
	}{
		"Prepare": {call: func(ctx context.Context, a account.DeletionAttempt, at time.Time) error {
			return deletions.Prepare(ctx, a, "hmac_alice", at)
		}},
		"Release":  {call: deletions.Release},
		"Complete": {prepared: true, call: deletions.Complete},
	}
	for name, op := range ops {
		for _, replaced := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/replaced=%v", name, replaced), func(t *testing.T) {
				newAccountDB(t)
				seedAccount(t, "alice", "alice@example.com")
				ctx, now := context.Background(), time.Now()
				stale, err := deletions.Acquire(ctx, account.User{ID: "alice"}, account.DeleteOptions{}, now)
				if err != nil {
					t.Fatalf("Acquire: %v", err)
				}
				if op.prepared {
					if err := deletions.Prepare(ctx, stale, "hmac_alice", now); err != nil {
						t.Fatalf("Prepare: %v", err)
					}
				}
				later := now.Add(2 * time.Minute)
				owner := stale.Owner
				if replaced {
					next, err := deletions.Acquire(ctx, account.User{ID: "alice"}, account.DeleteOptions{}, later)
					if err != nil {
						t.Fatalf("takeover Acquire: %v", err)
					}
					owner = next.Owner
				}
				before := attemptOf(t, "alice")

				if err := op.call(ctx, stale, later); !errors.Is(err, account.ErrDeletionInProgress) {
					t.Fatalf("%s by the stale owner = %v, want ErrDeletionInProgress", name, err)
				}
				if got := attemptOf(t, "alice"); got != before || got.Owner != owner {
					t.Errorf("attempt = %+v, want %+v unchanged", got, before)
				}
				if states := gateStates(t, "alice"); len(states) != 1 || states[0] != "in_progress" {
					t.Errorf("gate states = %v, want in_progress", states)
				}
				if n := countRows(t, "users", "id", "alice"); n != 1 {
					t.Errorf("users: %d row(s) of alice, want the account kept", n)
				}
			})
		}
	}
}

// Billing that moved after Acquire (a payment, a subscription change) may
// have changed eligibility, so the attempt stays reversible.
func TestAccountDeletionsPrepareRefusesWhenBillingMovedAfterAcquire(t *testing.T) {
	newAccountDB(t)
	seedAccount(t, "alice", "alice@example.com")
	ctx, now := context.Background(), time.Now()
	deletions := AccountDeletions{}
	a, err := deletions.Acquire(ctx, account.User{ID: "alice"}, account.DeleteOptions{}, now)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	if err := sqlitex.DB.Exec("UPDATE users SET billing_version = billing_version + 1 WHERE id = 'alice'").Error; err != nil {
		t.Fatal(err)
	}

	if err := deletions.Prepare(ctx, a, "hmac_alice", now); !errors.Is(err, account.ErrDeletionInProgress) {
		t.Fatalf("Prepare = %v, want ErrDeletionInProgress", err)
	}
	if got := attemptOf(t, "alice"); got.Phase != "checking" {
		t.Errorf("phase = %s, want checking", got.Phase)
	}
	if n := countRows(t, "trial_grants", "email_hmac", "hmac_alice"); n != 0 {
		t.Errorf("trial_grants: %d row(s), want none", n)
	}
	if err := deletions.Release(ctx, a, now); err != nil {
		t.Errorf("Release after the refusal: %v", err)
	}
}

func TestAccountDeletionsPrepareThatFailsLeavesTheAttemptReversible(t *testing.T) {
	newAccountDB(t)
	seedAccount(t, "alice", "alice@example.com")
	if err := sqlitex.DB.Exec("CREATE TRIGGER fail_trial_grant BEFORE INSERT ON trial_grants BEGIN SELECT RAISE(ABORT, 'trial grant write failed'); END").Error; err != nil {
		t.Fatal(err)
	}
	ctx, now := context.Background(), time.Now()
	deletions := AccountDeletions{}
	a, err := deletions.Acquire(ctx, account.User{ID: "alice"}, account.DeleteOptions{}, now)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}

	if err := deletions.Prepare(ctx, a, "hmac_alice", now); err == nil {
		t.Fatal("Prepare succeeded, want the trial grant write to fail it")
	}
	if got := attemptOf(t, "alice"); got.Phase != "checking" {
		t.Errorf("phase = %s, want checking", got.Phase)
	}
	if err := deletions.Release(ctx, a, now); err != nil {
		t.Errorf("Release after the failure: %v", err)
	}
	if states := gateStates(t, "alice"); len(states) != 0 {
		t.Errorf("gate states = %v, want the gate lifted", states)
	}
}

func TestAccountDeletionsCompleteDeletesTheAccountAndKeepsADeletedGate(t *testing.T) {
	newAccountDB(t)
	seedAccount(t, "alice", "alice@example.com")
	ctx, now := context.Background(), time.Now()
	deletions := AccountDeletions{}

	a, err := deletions.Acquire(ctx, account.User{ID: "alice"}, account.DeleteOptions{}, now)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	if err := deletions.Prepare(ctx, a, "hmac_alice", now); err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	if err := deletions.Complete(ctx, a, now); err != nil {
		t.Fatalf("Complete: %v", err)
	}

	if states := gateStates(t, "alice"); len(states) != 1 || states[0] != "deleted" {
		t.Errorf("gate states = %v, want one deleted gate", states)
	}
	if n := countRows(t, "users", "id", "alice"); n != 0 {
		t.Errorf("users: %d row(s) of alice, want the account deleted", n)
	}
	if n := countRows(t, "account_deletion_attempts", "user_id", "alice"); n != 0 {
		t.Errorf("account_deletion_attempts: %d row(s), want none", n)
	}
}
