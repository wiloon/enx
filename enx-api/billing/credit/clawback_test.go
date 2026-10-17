package credit

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

// Payment intent and amounts below follow the real sandbox events captured
// for ADR-049 (2026-10-16): a $4.99 top-up refunded $1.50, then the rest.

func TestClawbackFullTopupRefundTakesAllGrantedCredits(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	pi := "pi_" + t.Name()
	if err := GrantTopup(ctx, userID, 300, "evt-grant-"+t.Name(), pi); err != nil {
		t.Fatalf("GrantTopup: %v", err)
	}

	got, err := Clawback(ctx, pi, 499, 499, "evt-refund-"+t.Name(), "")
	if err != nil {
		t.Fatalf("Clawback: %v", err)
	}

	if got.UserID != userID || got.GrantType != TypeGrantTopup || got.Amount != 300 {
		t.Fatalf("Clawback = %+v, want user %s, GRANT_TOPUP, 300 clawed back", got, userID)
	}
	if acc := loadAccount(t, userID); acc.TopupBalance != 0 {
		t.Fatalf("topup = %d, want 0", acc.TopupBalance)
	}
	row := lastLedgerRow(t, userID)
	if row.Type != TypeClawback || row.Amount != -300 || row.BalanceAfter != 0 {
		t.Fatalf("ledger row = %+v, want CLAWBACK -300 balanceAfter=0", row)
	}
}

func TestClawbackLatestSubscriptionGrantTakesSubscriptionPoolDownToZero(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	pi := "pi_" + t.Name()
	if err := GrantSubscription(ctx, userID, 500, time.Now().Add(30*24*time.Hour), "evt-grant-"+t.Name(), pi); err != nil {
		t.Fatalf("GrantSubscription: %v", err)
	}
	if err := GrantTopup(ctx, userID, 40, "evt-topup-"+t.Name(), ""); err != nil {
		t.Fatalf("GrantTopup: %v", err)
	}
	if err := Settle(ctx, userID, "translate_sentence", 450); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	got, err := Clawback(ctx, pi, 300, 300, "evt-refund-"+t.Name(), "")
	if err != nil {
		t.Fatalf("Clawback: %v", err)
	}

	if got.GrantType != TypeGrantSubscription || got.Amount != 50 {
		t.Fatalf("Clawback = %+v, want GRANT_SUBSCRIPTION with 50 taken (what was left)", got)
	}
	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 0 || acc.TopupBalance != 40 {
		t.Fatalf("got subscription=%d topup=%d, want 0 and 40 untouched", acc.SubscriptionBalance, acc.TopupBalance)
	}
	if row := lastLedgerRow(t, userID); row.Type != TypeClawback || row.Amount != -50 || row.BalanceAfter != 0 {
		t.Fatalf("ledger row = %+v, want CLAWBACK -50 balanceAfter=0", row)
	}
}

// The next period's grant already replaced an older period's credits, so a
// refund of the older payment takes nothing, but still leaves a ledger row.
func TestClawbackOlderSubscriptionGrantTakesNothingButIsRecorded(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	oldPI := "pi_old_" + t.Name()
	periodEnd := time.Now().Add(30 * 24 * time.Hour)
	if err := GrantSubscription(ctx, userID, 500, periodEnd, "evt-grant-1-"+t.Name(), oldPI); err != nil {
		t.Fatalf("GrantSubscription: %v", err)
	}
	if err := GrantSubscription(ctx, userID, 500, periodEnd.Add(30*24*time.Hour), "evt-grant-2-"+t.Name(), "pi_new_"+t.Name()); err != nil {
		t.Fatalf("renewal GrantSubscription: %v", err)
	}

	got, err := Clawback(ctx, oldPI, 300, 300, "evt-refund-"+t.Name(), "")
	if err != nil {
		t.Fatalf("Clawback: %v", err)
	}

	if got.GrantType != TypeGrantSubscription || got.Amount != 0 {
		t.Fatalf("Clawback = %+v, want GRANT_SUBSCRIPTION with 0 taken", got)
	}
	if acc := loadAccount(t, userID); acc.SubscriptionBalance != 500 {
		t.Fatalf("subscription = %d, want 500 (current period untouched)", acc.SubscriptionBalance)
	}
	if row := lastLedgerRow(t, userID); row.Type != TypeClawback || row.Amount != 0 {
		t.Fatalf("ledger row = %+v, want a CLAWBACK row of 0", row)
	}
}

// Credits already spent are still owed: the top-up pool goes negative (AI
// turns off until the next top-up), and the trial pool is not a payment so
// it is never touched.
func TestClawbackTopupMayGoNegativeAndLeavesTrialAlone(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	pi := "pi_" + t.Name()
	mustGrantTrial(t, userID, 100, 7*24*time.Hour)
	if err := GrantTopup(ctx, userID, 300, "evt-grant-"+t.Name(), pi); err != nil {
		t.Fatalf("GrantTopup: %v", err)
	}
	// Spends the whole trial, then 200 of the top-up.
	if err := Settle(ctx, userID, "translate_sentence", 300); err != nil {
		t.Fatalf("Settle: %v", err)
	}

	if _, err := Clawback(ctx, pi, 499, 499, "evt-refund-"+t.Name(), ""); err != nil {
		t.Fatalf("Clawback: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TopupBalance != -200 || acc.TrialBalance != 0 {
		t.Fatalf("got topup=%d trial=%d, want topup=-200 and trial still 0", acc.TopupBalance, acc.TrialBalance)
	}
}

// Stripe does not deliver events in order: the full refund's event can land
// before the earlier partial refund's. The late one must take nothing, never
// hand credits back.
func TestClawbackOutOfOrderPartialRefundTakesNothing(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	pi := "pi_" + t.Name()
	if err := GrantTopup(ctx, userID, 300, "evt-grant-"+t.Name(), pi); err != nil {
		t.Fatalf("GrantTopup: %v", err)
	}

	if _, err := Clawback(ctx, pi, 499, 499, "evt-refund-2-"+t.Name(), ""); err != nil {
		t.Fatalf("full-refund Clawback: %v", err)
	}
	late, err := Clawback(ctx, pi, 150, 499, "evt-refund-1-"+t.Name(), "")
	if err != nil || late.Amount != 0 {
		t.Fatalf("late partial Clawback = %+v, %v; want 0 taken", late, err)
	}
	if acc := loadAccount(t, userID); acc.TopupBalance != 0 {
		t.Fatalf("topup = %d, want 0", acc.TopupBalance)
	}
}

// Two different refund events of one payment racing each other still take
// the grant exactly once in total.
func TestClawbackConcurrentRefundEventsTakeTheGrantOnce(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	pi := "pi_" + t.Name()
	if err := GrantTopup(ctx, userID, 300, "evt-grant-"+t.Name(), pi); err != nil {
		t.Fatalf("GrantTopup: %v", err)
	}

	var wg sync.WaitGroup
	for i, refunded := range []int64{150, 499} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := Clawback(ctx, pi, refunded, 499, fmt.Sprintf("evt-refund-%d-%s", i, t.Name()), ""); err != nil {
				t.Errorf("Clawback(%d): %v", refunded, err)
			}
		}()
	}
	wg.Wait()

	if acc := loadAccount(t, userID); acc.TopupBalance != 0 {
		t.Fatalf("topup = %d, want 0 (300 taken once in total)", acc.TopupBalance)
	}
}

func TestClawbackRejectsNothingCapturedWithoutTakingAnything(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	pi := "pi_" + t.Name()
	if err := GrantTopup(ctx, userID, 300, "evt-grant-"+t.Name(), pi); err != nil {
		t.Fatalf("GrantTopup: %v", err)
	}

	if _, err := Clawback(ctx, pi, 0, 0, "evt-refund-"+t.Name(), ""); err == nil {
		t.Fatal("Clawback with amount_captured=0 = nil, want an error")
	}
	if acc := loadAccount(t, userID); acc.TopupBalance != 300 {
		t.Fatalf("topup = %d, want 300 (untouched)", acc.TopupBalance)
	}
}

func TestClawbackUnknownPaymentIntentIsGrantNotFound(t *testing.T) {
	_, err := Clawback(context.Background(), "pi_never_granted_"+t.Name(), 100, 100, "evt-refund-"+t.Name(), "")
	if !errors.Is(err, ErrGrantNotFound) {
		t.Fatalf("Clawback = %v, want ErrGrantNotFound", err)
	}
}

// A Stripe retry of the same event takes nothing more, but still reports the
// grant so the webhook can retry a subscription cancel that failed.
func TestClawbackReplayOfSameEventTakesNothingMore(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	pi := "pi_" + t.Name()
	if err := GrantTopup(ctx, userID, 300, "evt-grant-"+t.Name(), pi); err != nil {
		t.Fatalf("GrantTopup: %v", err)
	}
	if _, err := Clawback(ctx, pi, 150, 499, "evt-refund-"+t.Name(), ""); err != nil {
		t.Fatalf("Clawback: %v", err)
	}

	replay, err := Clawback(ctx, pi, 150, 499, "evt-refund-"+t.Name(), "")
	if err != nil {
		t.Fatalf("replayed Clawback: %v", err)
	}
	if replay.Amount != 0 || replay.UserID != userID || replay.GrantType != TypeGrantTopup {
		t.Fatalf("replayed Clawback = %+v, want 0 taken from %s's GRANT_TOPUP", replay, userID)
	}
	if acc := loadAccount(t, userID); acc.TopupBalance != 210 {
		t.Fatalf("topup = %d, want 210 (300 − 90, once)", acc.TopupBalance)
	}
}

func TestClawbackPartialRefundsTakeTheDifferenceEachTime(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	pi := "pi_" + t.Name()
	if err := GrantTopup(ctx, userID, 300, "evt-grant-"+t.Name(), pi); err != nil {
		t.Fatalf("GrantTopup: %v", err)
	}

	// $1.50 of $4.99: floor(300 × 150 / 499) = 90.
	first, err := Clawback(ctx, pi, 150, 499, "evt-refund-1-"+t.Name(), "")
	if err != nil || first.Amount != 90 {
		t.Fatalf("first Clawback = %+v, %v; want 90", first, err)
	}
	// Then the rest (amount_refunded is cumulative): 300 − 90 = 210.
	second, err := Clawback(ctx, pi, 499, 499, "evt-refund-2-"+t.Name(), "")
	if err != nil || second.Amount != 210 {
		t.Fatalf("second Clawback = %+v, %v; want 210", second, err)
	}
	if acc := loadAccount(t, userID); acc.TopupBalance != 0 {
		t.Fatalf("topup = %d, want 0", acc.TopupBalance)
	}
}
