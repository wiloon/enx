package credit

import (
	"context"
	"sync"
	"testing"
	"time"

	"enx-api/utils/sqlitex"
)

// The trial pool (ADR-048): a one-off grant at sign-up that counts toward
// Balance until it expires, and is drawn down before the paid pools.

func TestGrantTrialCountsTowardBalance(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()

	granted, err := GrantTrial(ctx, userID, "email-"+userID, 100, 7*24*time.Hour)
	if err != nil {
		t.Fatalf("GrantTrial: %v", err)
	}
	if !granted {
		t.Fatal("granted = false, want true for a first grant")
	}

	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 100 {
		t.Fatalf("Balance = %d, want 100", got)
	}
}

func TestGrantTrialOnlyOncePerAccount(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantTrial(t, userID, 100, time.Hour)
	if err := Settle(ctx, userID, "translate_sentence", 40); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	granted, err := GrantTrial(ctx, userID, "email-"+userID, 100, time.Hour)
	if err != nil {
		t.Fatalf("second GrantTrial: %v", err)
	}
	if granted {
		t.Fatal("granted = true on a second call, want false")
	}
	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 60 {
		t.Fatalf("Balance = %d, want 60 (the spent trial is not topped back up)", got)
	}
}

// ADR-062 Decision 3: one trial per email, across deleted accounts.
func TestGrantTrialRecordsTheEmailAndSkipsItForAnotherAccount(t *testing.T) {
	ctx := context.Background()
	first, second := "u-"+t.Name()+"-1", "u-"+t.Name()+"-2"
	email := "hmac-" + t.Name()

	if granted, err := GrantTrial(ctx, first, email, 100, time.Hour); err != nil || !granted {
		t.Fatalf("first GrantTrial = %v, %v; want true", granted, err)
	}
	var grant sqlitex.TrialGrant
	if err := sqlitex.DB.Where("email_hmac = ?", email).First(&grant).Error; err != nil || grant.UserId != first {
		t.Fatalf("trial grant record = %+v, %v; want one for %s", grant, err, first)
	}

	granted, err := GrantTrial(ctx, second, email, 100, time.Hour)
	if err != nil || granted {
		t.Fatalf("GrantTrial for the same email = %v, %v; want false, nil", granted, err)
	}
	got, err := Balance(ctx, second)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 0 {
		t.Fatalf("Balance = %d, want 0 for an email that already had a trial", got)
	}
}

// The migration backfills a record for every existing user, including one
// whose sign-up trial failed: that account still gets its own trial.
func TestGrantTrialGrantsWhenTheRecordIsTheAccountsOwn(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	email := "hmac-" + t.Name()
	if err := sqlitex.DB.Create(&sqlitex.TrialGrant{EmailHmac: email, UserId: userID, GrantedAt: 1}).Error; err != nil {
		t.Fatalf("seed trial_grants: %v", err)
	}

	if granted, err := GrantTrial(ctx, userID, email, 100, time.Hour); err != nil || !granted {
		t.Fatalf("GrantTrial = %v, %v; want true for the record's own account", granted, err)
	}
}

func TestGrantTrialWithoutAnEmailGrantsNothing(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	granted, err := GrantTrial(ctx, userID, "", 100, time.Hour)
	if err != nil || granted {
		t.Fatalf("GrantTrial without an email = %v, %v; want false, nil", granted, err)
	}
	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 0 {
		t.Fatalf("Balance = %d, want 0", got)
	}
}

func TestGrantTrialZeroAmountIsOff(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()

	granted, err := GrantTrial(ctx, userID, "email-"+userID, 0, time.Hour)
	if err != nil || granted {
		t.Fatalf("GrantTrial(0) = %v, %v; want false, nil", granted, err)
	}
	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 0 {
		t.Fatalf("Balance = %d, want 0", got)
	}
}

func TestBalanceIgnoresExpiredTrial(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 5, 0)
	mustGrantTrial(t, userID, 100, time.Hour)

	setClock(t, time.Now().Add(time.Hour+time.Second))

	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 5 {
		t.Fatalf("Balance = %d, want 5 (expired trial not counted)", got)
	}
}

func TestSettleAfterExpiryForfeitsTrialAndRecordsExpire(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 10, 0)
	mustGrantTrial(t, userID, 30, time.Hour)
	setClock(t, time.Now().Add(2*time.Hour))

	if err := Settle(ctx, userID, "translate_sentence", 4); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TrialBalance != 0 || acc.SubscriptionBalance != 6 {
		t.Fatalf("got trial=%d subscription=%d, want 0/6 (expired trial not spent)", acc.TrialBalance, acc.SubscriptionBalance)
	}
	var rows []sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ? AND type = ?", userID, TypeExpire).Find(&rows).Error; err != nil {
		t.Fatalf("load EXPIRE rows: %v", err)
	}
	if len(rows) != 1 || rows[0].Amount != -30 {
		t.Fatalf("EXPIRE rows = %+v, want one row of -30", rows)
	}

	if err := Settle(ctx, userID, "translate_sentence", 1); err != nil {
		t.Fatalf("second Settle: %v", err)
	}
	var count int64
	if err := sqlitex.DB.Model(&sqlitex.CreditTransaction{}).Where("user_id = ? AND type = ?", userID, TypeExpire).Count(&count).Error; err != nil {
		t.Fatalf("count EXPIRE rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("EXPIRE rows after a second Settle = %d, want still 1", count)
	}
}

func TestSettleConcurrentKeepsTrialNonNegativeAndLosesNothing(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 10, 100)
	mustGrantTrial(t, userID, 20, time.Hour)

	const goroutines, costEach = 50, 3
	var wg sync.WaitGroup
	errs := make(chan error, goroutines)
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := Settle(ctx, userID, "translate_sentence", costEach); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TrialBalance != 0 || acc.SubscriptionBalance != 0 {
		t.Fatalf("got trial=%d subscription=%d, want both drained to exactly 0", acc.TrialBalance, acc.SubscriptionBalance)
	}
	if want := int64(130 - goroutines*costEach); acc.TopupBalance != want {
		t.Fatalf("topup = %d, want %d (a lost write)", acc.TopupBalance, want)
	}
}

func mustGrantTrial(t *testing.T, userID string, amount int64, ttl time.Duration) {
	t.Helper()
	if _, err := GrantTrial(context.Background(), userID, "email-"+userID, amount, ttl); err != nil {
		t.Fatalf("setup GrantTrial: %v", err)
	}
}

// setClock moves the ledger's trial clock to at for the rest of the test.
func setClock(t *testing.T, at time.Time) {
	t.Helper()
	prev := now
	now = func() time.Time { return at }
	t.Cleanup(func() { now = prev })
}

func TestSettleDrawsTrialBeforeSubscriptionAndTopup(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 10, 10)
	mustGrantTrial(t, userID, 5, time.Hour)

	if err := Settle(ctx, userID, "translate_sentence", 8); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TrialBalance != 0 || acc.SubscriptionBalance != 7 || acc.TopupBalance != 10 {
		t.Fatalf("got trial=%d subscription=%d topup=%d, want 0/7/10",
			acc.TrialBalance, acc.SubscriptionBalance, acc.TopupBalance)
	}
}

func TestSettleOverrunSpillsFromTrialThroughToTopup(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 2, 1)
	mustGrantTrial(t, userID, 3, time.Hour)

	if err := Settle(ctx, userID, "translate_sentence", 10); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TrialBalance != 0 || acc.SubscriptionBalance != 0 || acc.TopupBalance != -4 {
		t.Fatalf("got trial=%d subscription=%d topup=%d, want 0/0/-4",
			acc.TrialBalance, acc.SubscriptionBalance, acc.TopupBalance)
	}
}

// A user whose AI access comes from the trial alone never goes into debt:
// the part of a charge the trial can't cover is written off, so top-up stays
// at zero and the ledger records only what was actually taken.
func TestSettleWritesOffTrialOnlyOverrun(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantTrial(t, userID, 3, time.Hour)

	if err := Settle(ctx, userID, "translate_sentence", 10); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TrialBalance != 0 || acc.SubscriptionBalance != 0 || acc.TopupBalance != 0 {
		t.Fatalf("got trial=%d subscription=%d topup=%d, want 0/0/0",
			acc.TrialBalance, acc.SubscriptionBalance, acc.TopupBalance)
	}
	var rows []sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ? AND type = ?", userID, TypeSettle).Find(&rows).Error; err != nil {
		t.Fatalf("load SETTLE rows: %v", err)
	}
	if len(rows) != 1 || rows[0].Amount != -3 || rows[0].BalanceAfter != 0 {
		t.Fatalf("SETTLE rows = %+v, want one row of -3 with balance 0", rows)
	}
}
