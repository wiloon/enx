package credit

import (
	"context"
	"testing"
)

// Balance is the pre-call affordability check for token-metered features
// (ADR-012 Decision 5): it returns the sum of both pools, which may be
// negative after a Settle overran the top-up pool.

func TestBalanceSumsBothPools(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 3, 4)

	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 7 {
		t.Fatalf("got %d, want 7", got)
	}
}

func TestBalanceCanBeNegative(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 1, 1)
	if err := Settle(ctx, userID, "rephrase_to_english", 5); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != -3 {
		t.Fatalf("got %d, want -3", got)
	}
}

func TestBalanceBrandNewUserIsZero(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()

	got, err := Balance(ctx, userID)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 0 {
		t.Fatalf("got %d, want 0", got)
	}
}
