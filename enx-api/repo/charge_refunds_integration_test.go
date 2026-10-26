package repo

import (
	"context"
	"reflect"
	"testing"

	"enx-api/billing/chargerefunded"
	"enx-api/billing/legacyprovenance"
	"enx-api/billing/webhookevent"
)

// backfillingRefundStore interleaves a real backfill after the real grant
// read; all owner, ledger and revision reads still use ChargeRefunds.
type backfillingRefundStore struct {
	ChargeRefunds
	afterGrant func()
}

func (s *backfillingRefundStore) Payload(context.Context, webhookevent.Scope) ([]byte, error) {
	return []byte(`{"api_version":"2026-08-26.dahlia","data":{"object":{"id":"ch_refund","object":"charge","payment_intent":"pi_subscribed","amount_refunded":500,"amount_captured":1000}}}`), nil
}

func (s *backfillingRefundStore) GrantForPaymentIntent(ctx context.Context, id string) (chargerefunded.Grant, bool, error) {
	g, found, err := s.ChargeRefunds.GrantForPaymentIntent(ctx, id)
	if s.afterGrant != nil {
		s.afterGrant()
		s.afterGrant = nil
	}
	return g, found, err
}

type refundStripe struct{ cancelled []string }

func (*refundStripe) SubscriptionStatus(context.Context, string) (string, error) {
	return "active", nil
}

func (s *refundStripe) CancelSubscriptionNow(_ context.Context, id string) error {
	s.cancelled = append(s.cancelled, id)
	return nil
}

func TestChargeRefundsRetriesAMixedBackfillSnapshotBeforeApplyingTheRefund(t *testing.T) {
	newSubscriptionConflictDB(t, "subscribed.sql")
	ctx := context.Background()
	store := &backfillingRefundStore{afterGrant: func() {
		err := (LegacyProvenance{}).Record(ctx,
			legacyprovenance.Grant{TransactionID: "tx_subscribed_grant", SubscriptionID: "sub_subscribed", PoolPeriodEnd: 1800000000},
			legacyprovenance.Result{Pinned: true, InvoiceID: "in_subscribed", Source: subscribedMay})
		if err != nil {
			t.Fatal(err)
		}
	}}
	stripe := &refundStripe{}
	handler := chargerefunded.NewHandler(store, stripe)
	task := webhookevent.StoredTask{Scope: eventScope("evt_refund")}

	first := handler.Handle(ctx, task)
	if first.Step != webhookevent.Transient || first.Effects != nil {
		t.Fatalf("mixed snapshot result = %+v, want retry without effects", first)
	}
	if got := clawbackRows(t); len(got) != 0 {
		t.Fatalf("clawbacks before retry = %+v, want none", got)
	}
	if len(stripe.cancelled) != 0 {
		t.Fatalf("cancelled before retry = %v, want none", stripe.cancelled)
	}

	retry := handler.Handle(ctx, task)
	if retry.Step != webhookevent.Handled {
		t.Fatalf("retry = %+v, want handled", retry)
	}
	effects, ok := retry.Effects.(chargerefunded.Effects)
	if !ok {
		t.Fatalf("retry effects = %T, want chargerefunded.Effects", retry.Effects)
	}
	if err := applyClawback(t, task.Scope, effects); err != nil {
		t.Fatal(err)
	}
	if got := refundOwner(t, "u_subscribed").SubscriptionBalance; got != 250 {
		t.Errorf("subscription balance = %d, want 250", got)
	}
	if got := clawbackRows(t); len(got) != 1 || got[0].Amount != -250 {
		t.Errorf("clawbacks = %+v, want one taking 250", got)
	}
	if !reflect.DeepEqual(stripe.cancelled, []string{"sub_subscribed"}) {
		t.Errorf("cancelled = %v, want only sub_subscribed", stripe.cancelled)
	}
}
