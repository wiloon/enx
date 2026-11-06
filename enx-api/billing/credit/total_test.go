package credit

import (
	"context"
	"sync"
	"testing"
	"time"

	"enx-api/utils/sqlitex"
)

// ADR-063 Decisions 7, 9 and 10: every ledger row records the three-pool
// total after it, an expired trial is forfeited before any other write, and
// an hourly sweep forfeits the ones no write reaches.

type totalRow struct {
	Type    string
	Feature string
	Amount  int64
	Total   *int64
}

func ledgerTotals(t *testing.T, userID string) []totalRow {
	t.Helper()
	var rows []totalRow
	if err := sqlitex.DB.Raw("SELECT type, feature, amount, total_balance_after AS total FROM credit_transactions "+
		"WHERE user_id = ? ORDER BY rowid", userID).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

// assertReconciles checks that each row's amount is the change in the total
// across it, starting from an empty account.
func assertReconciles(t *testing.T, rows []totalRow) {
	t.Helper()
	var prev int64
	for i, r := range rows {
		if r.Total == nil {
			t.Fatalf("row %d (%s) has no total_balance_after", i, r.Type)
		}
		if r.Amount != *r.Total-prev {
			t.Errorf("row %d (%s): amount %d, but the total moved %d -> %d", i, r.Type, r.Amount, prev, *r.Total)
		}
		prev = *r.Total
	}
}

func types(rows []totalRow) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.Type
	}
	return out
}

func sameTypes(got []totalRow, want ...string) bool {
	g := types(got)
	if len(g) != len(want) {
		return false
	}
	for i := range g {
		if g[i] != want[i] {
			return false
		}
	}
	return true
}

func TestAdminGrantAfterTrialExpiryWritesTheExpiryFirst(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantTrial(t, userID, 30, time.Hour)
	setClock(t, time.Now().Add(2*time.Hour))

	if err := GrantAdmin(ctx, userID, 50, "goodwill"); err != nil {
		t.Fatalf("GrantAdmin: %v", err)
	}

	rows := ledgerTotals(t, userID)
	if !sameTypes(rows, TypeGrantTrial, TypeExpire, TypeGrantAdmin) {
		t.Fatalf("ledger = %v, want the trial, its expiry, then the admin grant", types(rows))
	}
	assertReconciles(t, rows)
	if got := *rows[2].Total; got != 50 {
		t.Errorf("total after the grant = %d, want 50", got)
	}
}

func TestAdminDeductionRecordsTheTotalAcrossPools(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantTrial(t, userID, 30, time.Hour)

	if err := DeductAdmin(ctx, userID, 10, "correction"); err != nil {
		t.Fatalf("DeductAdmin: %v", err)
	}

	rows := ledgerTotals(t, userID)
	assertReconciles(t, rows)
	if got := *rows[len(rows)-1].Total; got != 20 {
		t.Errorf("total after the deduction = %d, want the trial's 30 less 10", got)
	}
}

// Owner decision 2026-11-06: a bonus on an expired trial does not revive
// what was left of it.
func TestReferralBonusOnAnExpiredTrialForfeitsTheLeftoverFirst(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantTrial(t, userID, 30, time.Hour)
	at := time.Now().Add(2 * time.Hour)
	setClock(t, at)

	if _, err := GrantReferralBonus(ctx, userID, ReferralBonus{Amount: 50, ExpiresAt: at.Add(24 * time.Hour)}); err != nil {
		t.Fatalf("GrantReferralBonus: %v", err)
	}

	rows := ledgerTotals(t, userID)
	if !sameTypes(rows, TypeGrantTrial, TypeExpire, TypeGrantReferralBonus) {
		t.Fatalf("ledger = %v, want the trial, its expiry, then the bonus", types(rows))
	}
	if rows[1].Amount != -30 || rows[1].Feature != "trial" {
		t.Errorf("expiry = %+v, want -30 of feature trial", rows[1])
	}
	assertReconciles(t, rows)
	balance, _, err := Trial(ctx, userID)
	if err != nil || balance != 50 {
		t.Errorf("spendable trial = %d, %v; want the bonus of 50 only", balance, err)
	}
}

func TestSettleRecordsTheTotalAfterTheCharge(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantTrial(t, userID, 30, time.Hour)
	setClock(t, time.Now().Add(2*time.Hour))
	if err := GrantAdmin(ctx, userID, 100, "seed"); err != nil {
		t.Fatalf("GrantAdmin: %v", err)
	}

	if err := Settle(ctx, userID, "translate_sentence", 7); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	rows := ledgerTotals(t, userID)
	assertReconciles(t, rows)
	if got := *rows[len(rows)-1].Total; got != 93 {
		t.Errorf("total after the charge = %d, want 93", got)
	}
}

func expireRows(t *testing.T, userID string) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Model(&sqlitex.CreditTransaction{}).Where("user_id = ? AND type = ?", userID, TypeExpire).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

func mustSweep(t *testing.T) TrialSweep {
	t.Helper()
	run, err := ExpireTrials(context.Background())
	if err != nil {
		t.Fatalf("ExpireTrials: %v", err)
	}
	return run
}

func TestExpireTrialsForfeitsOnlyExpiredTrialsWithCreditsLeft(t *testing.T) {
	ctx := context.Background()
	expired, live, empty, fenced := "u-"+t.Name()+"-expired", "u-"+t.Name()+"-live", "u-"+t.Name()+"-empty", "u-"+t.Name()+"-fenced"
	for _, id := range []string{expired, live, empty, fenced} {
		seedCreditUser(t, id)
	}
	mustGrantTrial(t, expired, 30, time.Hour)
	mustGrantTrial(t, empty, 30, time.Hour)
	if err := Settle(ctx, empty, "translate_sentence", 30); err != nil {
		t.Fatalf("Settle: %v", err)
	}
	mustGrantTrial(t, fenced, 30, time.Hour)
	mustGrantTrial(t, live, 30, 10*time.Hour)
	if err := sqlitex.DB.Exec("INSERT INTO account_deletion_gates (user_id, state, started_at, updated_at) VALUES (?, 'in_progress', 1, 1)", fenced).Error; err != nil {
		t.Fatal(err)
	}
	setClock(t, time.Now().Add(2*time.Hour))

	mustSweep(t)
	mustSweep(t)

	if n := expireRows(t, expired); n != 1 {
		t.Errorf("EXPIRE rows of the expired trial = %d, want 1 across two runs", n)
	}
	rows := ledgerTotals(t, expired)
	assertReconciles(t, rows)
	if acc := loadAccount(t, expired); acc.TrialBalance != 0 {
		t.Errorf("expired trial balance = %d, want 0", acc.TrialBalance)
	}
	for _, id := range []string{live, empty, fenced} {
		if n := expireRows(t, id); n != 0 {
			t.Errorf("EXPIRE rows of %s = %d, want none", id, n)
		}
	}
	if acc := loadAccount(t, fenced); acc.TrialBalance != 30 {
		t.Errorf("fenced trial balance = %d, want 30 left alone during deletion", acc.TrialBalance)
	}
}

func TestExpireTrialsContinuesPastAFailedAccountAndRetriesIt(t *testing.T) {
	failing, other := "u-"+t.Name()+"-failing", "u-"+t.Name()+"-other"
	for _, id := range []string{failing, other} {
		seedCreditUser(t, id)
		mustGrantTrial(t, id, 30, time.Hour)
	}
	setClock(t, time.Now().Add(2*time.Hour))
	if err := sqlitex.DB.Exec("CREATE TRIGGER fail_expire BEFORE INSERT ON credit_transactions " +
		"WHEN NEW.user_id = '" + failing + "' AND NEW.type = 'EXPIRE' BEGIN SELECT RAISE(ABORT, 'injected failure'); END").Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlitex.DB.Exec("DROP TRIGGER IF EXISTS fail_expire") })

	run := mustSweep(t)

	if len(run.Errors) != 1 {
		t.Errorf("errors = %v, want one for the failing account", run.Errors)
	}
	if n := expireRows(t, other); n != 1 {
		t.Errorf("EXPIRE rows of the other account = %d, want 1", n)
	}
	if acc := loadAccount(t, failing); acc.TrialBalance != 30 || expireRows(t, failing) != 0 {
		t.Errorf("failing account: trial %d, want 30 and no EXPIRE row", acc.TrialBalance)
	}

	if err := sqlitex.DB.Exec("DROP TRIGGER fail_expire").Error; err != nil {
		t.Fatal(err)
	}
	mustSweep(t)

	if n := expireRows(t, failing); n != 1 {
		t.Errorf("EXPIRE rows of the failed account after the next run = %d, want 1", n)
	}
}

func TestExpireTrialsRacingSettleWritesOneExpiry(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantTrial(t, userID, 30, time.Hour)
	if err := GrantAdmin(ctx, userID, 100, "seed"); err != nil {
		t.Fatalf("GrantAdmin: %v", err)
	}
	setClock(t, time.Now().Add(2*time.Hour))

	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for i := 0; i < 10; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			if _, err := ExpireTrials(ctx); err != nil {
				errs <- err
			}
		}()
		go func() {
			defer wg.Done()
			if err := Settle(ctx, userID, "translate_sentence", 1); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("racing write: %v", err)
	}

	if n := expireRows(t, userID); n != 1 {
		t.Errorf("EXPIRE rows = %d, want exactly 1", n)
	}
	assertReconciles(t, ledgerTotals(t, userID))
}
