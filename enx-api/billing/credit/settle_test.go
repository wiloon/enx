package credit

import (
	"context"
	"sync"
	"testing"
)

// Settle is the "post-hoc, pay for actual usage" primitive for token-metered
// features (ADR-012 Decision 5). Unlike Consume it never rejects for
// insufficient funds -- the AI call already happened -- and it may drive the
// top-up pool negative.

func TestSettleDrawsFromSubscriptionPoolFirst(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 10, 5)

	if err := Settle(ctx, userID, "rephrase_to_english", 3); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 7 || acc.TopupBalance != 5 {
		t.Fatalf("got subscription=%d topup=%d, want subscription=7 topup=5", acc.SubscriptionBalance, acc.TopupBalance)
	}
}

func TestSettleRejectsNegativeCost(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 5, 5)

	if err := Settle(ctx, userID, "rephrase_to_english", -1); err == nil {
		t.Fatal("expected an error for a negative cost")
	}

	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 5 || acc.TopupBalance != 5 {
		t.Fatalf("got subscription=%d topup=%d, want balances untouched 5/5", acc.SubscriptionBalance, acc.TopupBalance)
	}
}

// A zero cost is a no-op: ceil() in the cost formula floors at 1, but Settle
// shouldn't blow up if a caller ever passes 0.
func TestSettleZeroCostIsNoOp(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 5, 5)

	if err := Settle(ctx, userID, "rephrase_to_english", 0); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 5 || acc.TopupBalance != 5 {
		t.Fatalf("got subscription=%d topup=%d, want balances untouched 5/5", acc.SubscriptionBalance, acc.TopupBalance)
	}
}

// The AI call already happened, so an over-budget Settle drives the top-up
// pool negative rather than failing. The next request's Balance pre-check is
// what stops the user.
func TestSettleDrivesTopupPoolNegativeWhenOverBudget(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 1, 1)

	if err := Settle(ctx, userID, "rephrase_to_english", 5); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 0 || acc.TopupBalance != -3 {
		t.Fatalf("got subscription=%d topup=%d, want subscription=0 topup=-3", acc.SubscriptionBalance, acc.TopupBalance)
	}
}

// Unlike Consume (which leaves a pool untouched if it can't cover the whole
// cost), Settle drains the subscription pool to zero and takes the rest from
// top-up.
func TestSettleSpillsRemainderToTopupPool(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 2, 5)

	if err := Settle(ctx, userID, "rephrase_to_english", 3); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 0 || acc.TopupBalance != 4 {
		t.Fatalf("got subscription=%d topup=%d, want subscription=0 topup=4", acc.SubscriptionBalance, acc.TopupBalance)
	}
}

// Concurrent Settle calls for the same user must not lose writes: the total
// deducted has to equal the sum of every call's cost, even as the balance
// goes negative. Mirrors TestConsumeConcurrencyNoOverspend.
func TestSettleConcurrentNoLostWrites(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 10, 100)

	const (
		goroutines = 50
		costEach   = 3
		granted    = 110
	)
	var wg sync.WaitGroup
	errs := make(chan error, goroutines)
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := Settle(ctx, userID, "rephrase_to_english", costEach); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("Settle: %v", err)
	}

	// The total deducted must be exact: no update may be lost.
	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	want := int64(granted - goroutines*costEach)
	if got != want {
		t.Fatalf("total balance = %d, want %d (a lost write)", got, want)
	}
}

// Under concurrency the subscription pool must still never go negative --
// GrantSubscription replaces (not adds to) that balance, so a negative
// there would be silently forgiven on renewal. The single atomic UPDATE in
// Settle is what guarantees this; the earlier read-then-write version did
// not.
func TestSettleConcurrentKeepsSubscriptionNonNegative(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 5, 100)

	const (
		goroutines = 20
		costEach   = 3
		granted    = 105
	)
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := Settle(ctx, userID, "rephrase_to_english", costEach); err != nil {
				t.Errorf("Settle: %v", err)
			}
		}()
	}
	wg.Wait()

	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 0 {
		t.Fatalf("subscription_balance = %d, want 0 (never negative)", acc.SubscriptionBalance)
	}
	// The subscription pool (5) is fully drained; the remaining
	// 20*3 - 5 = 55 comes out of top-up, leaving 100 - 55 = 45.
	const wantTopup = 100 - (goroutines*costEach - 5)
	if acc.TopupBalance != wantTopup {
		t.Fatalf("topup_balance = %d, want %d", acc.TopupBalance, wantTopup)
	}
}
