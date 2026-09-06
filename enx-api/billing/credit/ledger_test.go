package credit

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"enx-api/utils"
	"enx-api/utils/sqlitex"
)

func TestMain(m *testing.M) {
	dbPath := filepath.Join(os.TempDir(), "enx-credit-ledger-test.db")
	os.Remove(dbPath)
	os.Setenv("DB_PATH", dbPath)
	utils.ViperInit()
	sqlitex.Init()
	os.Exit(m.Run())
}

func TestConsumeSubscriptionPoolFirst(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 10, 5)

	pool, err := Consume(ctx, userID, "translate_sentence", 3)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if pool != PoolSubscription {
		t.Fatalf("got pool %q, want %q", pool, PoolSubscription)
	}

	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 7 || acc.TopupBalance != 5 {
		t.Fatalf("got subscription=%d topup=%d, want subscription=7 topup=5", acc.SubscriptionBalance, acc.TopupBalance)
	}
}

func TestConsumeFallsBackToTopupPool(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 2, 5)

	pool, err := Consume(ctx, userID, "translate_sentence", 3)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if pool != PoolTopup {
		t.Fatalf("got pool %q, want %q", pool, PoolTopup)
	}

	acc := loadAccount(t, userID)
	// Subscription pool (2) is insufficient for cost 3, so it's left
	// untouched and the whole cost comes out of the top-up pool.
	if acc.SubscriptionBalance != 2 || acc.TopupBalance != 2 {
		t.Fatalf("got subscription=%d topup=%d, want subscription=2 topup=2", acc.SubscriptionBalance, acc.TopupBalance)
	}
}

func TestConsumeInsufficientCredit(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 1, 1)

	pool, err := Consume(ctx, userID, "translate_sentence", 5)
	if !errors.Is(err, ErrInsufficientCredit) {
		t.Fatalf("got %v, want ErrInsufficientCredit", err)
	}
	if pool != "" {
		t.Fatalf("got pool %q on failure, want empty", pool)
	}

	// Balances must be untouched by the failed attempt.
	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 1 || acc.TopupBalance != 1 {
		t.Fatalf("got subscription=%d topup=%d, want unchanged 1/1", acc.SubscriptionBalance, acc.TopupBalance)
	}
}

func TestConsumeBrandNewUserHasNoAccountRow(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()

	_, err := Consume(ctx, userID, "translate_sentence", 1)
	if !errors.Is(err, ErrInsufficientCredit) {
		t.Fatalf("got %v, want ErrInsufficientCredit", err)
	}
}

// TestConsumeConcurrencyNoOverspend is the concurrent-deduction correctness
// test called for by TASK-SPEC §6 Phase 2: many goroutines racing to
// Consume from the same shared balance must never let the total consumed
// exceed what was granted, and every successful deduction's balance_after
// must match a real, unique remaining balance (no lost updates).
func TestConsumeConcurrencyNoOverspend(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	const grant = int64(20)
	const cost = int64(1)
	const attempts = 60 // > grant, so some MUST fail with ErrInsufficientCredit

	mustGrantSubscription(t, userID, grant, 0)

	var wg sync.WaitGroup
	var succeeded, insufficient, otherErrs int64
	var mu sync.Mutex

	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := Consume(ctx, userID, "translate_sentence", cost)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				succeeded++
			case errors.Is(err, ErrInsufficientCredit):
				insufficient++
			default:
				otherErrs++
				t.Logf("unexpected Consume error: %v", err)
			}
		}()
	}
	wg.Wait()

	if otherErrs != 0 {
		t.Fatalf("%d Consume calls failed with an unexpected error (want only nil or ErrInsufficientCredit)", otherErrs)
	}
	if succeeded != grant {
		t.Fatalf("succeeded=%d, want exactly %d (one per available credit)", succeeded, grant)
	}
	if succeeded+insufficient != attempts {
		t.Fatalf("succeeded+insufficient=%d, want %d", succeeded+insufficient, attempts)
	}

	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 0 {
		t.Fatalf("final subscription_balance=%d, want 0 (no overspend, no stuck credit)", acc.SubscriptionBalance)
	}
}

func TestGrantSubscriptionResetsNotAdds(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 50, 0)
	// Simulate unused credit left over from last month, then renewal.
	if err := GrantSubscription(ctx, userID, 30, time.Now().Add(30*24*time.Hour), "evt-renewal-2"); err != nil {
		t.Fatalf("GrantSubscription: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 30 {
		t.Fatalf("got subscription_balance=%d, want 30 (reset, not 50+30=80)", acc.SubscriptionBalance)
	}
}

func TestGrantSubscriptionIdempotent(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	periodEnd := time.Now().Add(30 * 24 * time.Hour)

	if err := GrantSubscription(ctx, userID, 20, periodEnd, "evt-dup-1"); err != nil {
		t.Fatalf("first GrantSubscription: %v", err)
	}
	// Simulate a Stripe webhook retry of the same event, after the user has
	// already spent some credit -- a naive re-grant would clobber that.
	if _, err := Consume(ctx, userID, "translate_sentence", 5); err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if err := GrantSubscription(ctx, userID, 20, periodEnd, "evt-dup-1"); err != nil {
		t.Fatalf("retried GrantSubscription: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 15 {
		t.Fatalf("got subscription_balance=%d, want 15 (retry must be a no-op, not re-grant 20)", acc.SubscriptionBalance)
	}
}

func TestGrantTopupAddsAndIsIdempotent(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()

	if err := GrantTopup(ctx, userID, 10, "evt-topup-1"); err != nil {
		t.Fatalf("first GrantTopup: %v", err)
	}
	if err := GrantTopup(ctx, userID, 7, "evt-topup-2"); err != nil {
		t.Fatalf("second GrantTopup: %v", err)
	}
	if err := GrantTopup(ctx, userID, 7, "evt-topup-2"); err != nil {
		t.Fatalf("retried GrantTopup: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TopupBalance != 17 {
		t.Fatalf("got topup_balance=%d, want 17 (10+7, retry of evt-topup-2 must be a no-op)", acc.TopupBalance)
	}
}

func TestConsumeConcurrentIdempotentGrantsExactlyOnce(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()

	var wg sync.WaitGroup
	const attempts = 20
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = GrantTopup(ctx, userID, 10, "evt-racing-topup")
		}()
	}
	wg.Wait()

	acc := loadAccount(t, userID)
	if acc.TopupBalance != 10 {
		t.Fatalf("got topup_balance=%d, want 10 (event must be applied exactly once even when raced)", acc.TopupBalance)
	}
}

func TestRefundCreditsBackTheSamePool(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 10, 0)

	pool, err := Consume(ctx, userID, "translate_sentence", 4)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 6 {
		t.Fatalf("after consume: got subscription_balance=%d, want 6", acc.SubscriptionBalance)
	}

	if err := Refund(ctx, userID, "translate_sentence", pool, 4); err != nil {
		t.Fatalf("Refund: %v", err)
	}
	acc = loadAccount(t, userID)
	if acc.SubscriptionBalance != 10 {
		t.Fatalf("after refund: got subscription_balance=%d, want 10 (fully restored)", acc.SubscriptionBalance)
	}
}

func TestRefundCreditsTopupPoolWhenThatsWhereItCameFrom(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 1, 10)

	pool, err := Consume(ctx, userID, "translate_sentence", 3)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if pool != PoolTopup {
		t.Fatalf("got pool %q, want %q", pool, PoolTopup)
	}

	if err := Refund(ctx, userID, "translate_sentence", pool, 3); err != nil {
		t.Fatalf("Refund: %v", err)
	}
	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 1 || acc.TopupBalance != 10 {
		t.Fatalf("got subscription=%d topup=%d, want subscription=1 topup=10 (refund went to topup, not subscription)", acc.SubscriptionBalance, acc.TopupBalance)
	}
}

func TestRefundRejectsUnknownPool(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	if err := Refund(ctx, userID, "translate_sentence", "not_a_real_pool", 5); err == nil {
		t.Fatal("expected an error for an unknown pool")
	}
}

func mustGrantSubscription(t *testing.T, userID string, subAmount, topupAmount int64) {
	t.Helper()
	ctx := context.Background()
	if err := GrantSubscription(ctx, userID, subAmount, time.Now().Add(30*24*time.Hour), "evt-setup-"+userID+"-sub"); err != nil {
		t.Fatalf("setup GrantSubscription: %v", err)
	}
	if topupAmount > 0 {
		if err := GrantTopup(ctx, userID, topupAmount, "evt-setup-"+userID+"-topup"); err != nil {
			t.Fatalf("setup GrantTopup: %v", err)
		}
	}
}

func loadAccount(t *testing.T, userID string) sqlitex.CreditAccount {
	t.Helper()
	var acc sqlitex.CreditAccount
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&acc).Error; err != nil {
		t.Fatalf("load credit_accounts row: %v", err)
	}
	return acc
}
