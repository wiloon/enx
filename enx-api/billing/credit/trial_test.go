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

	granted, err := GrantTrial(ctx, userID, 100, 7*24*time.Hour)
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

	granted, err := GrantTrial(ctx, userID, 100, time.Hour)
	if err != nil {
		t.Fatalf("second GrantTrial: %v", err)
	}
	if granted {
		t.Fatal("granted = true on a second call, want false")
	}
	if got, _ := Balance(ctx, userID); got != 60 {
		t.Fatalf("Balance = %d, want 60 (the spent trial is not topped back up)", got)
	}
}

func TestGrantTrialZeroAmountIsOff(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()

	granted, err := GrantTrial(ctx, userID, 0, time.Hour)
	if err != nil || granted {
		t.Fatalf("GrantTrial(0) = %v, %v; want false, nil", granted, err)
	}
	if got, _ := Balance(ctx, userID); got != 0 {
		t.Fatalf("Balance = %d, want 0", got)
	}
}

func TestBalanceIgnoresExpiredTrial(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 5, 0)
	mustGrantTrial(t, userID, 100, time.Hour)

	setClock(t, time.Now().Add(time.Hour+time.Second))

	if got, _ := Balance(ctx, userID); got != 5 {
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
	sqlitex.DB.Where("user_id = ? AND type = ?", userID, TypeExpire).Find(&rows)
	if len(rows) != 1 || rows[0].Amount != -30 {
		t.Fatalf("EXPIRE rows = %+v, want one row of -30", rows)
	}

	if err := Settle(ctx, userID, "translate_sentence", 1); err != nil {
		t.Fatalf("second Settle: %v", err)
	}
	var count int64
	sqlitex.DB.Model(&sqlitex.CreditTransaction{}).Where("user_id = ? AND type = ?", userID, TypeExpire).Count(&count)
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
	if _, err := GrantTrial(context.Background(), userID, amount, ttl); err != nil {
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
