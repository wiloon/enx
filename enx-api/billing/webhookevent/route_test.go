package webhookevent

import "testing"

func TestRoute(t *testing.T) {
	const supported = "2026-08-26.dahlia"
	cases := []struct {
		eventType string
		want      Kind
	}{
		{"checkout.session.completed", KindCheckout},
		{"invoice.paid", KindInvoicePaid},
		{"charge.refunded", KindRefund},
		{"invoice.payment_failed", KindSnapshot},
		{"invoice.voided", KindSnapshot},
		{"customer.subscription.updated", KindSnapshot},
		{"customer.subscription.deleted", KindSnapshot},
		{"customer.subscription.pending_update_applied", KindSnapshot},
		{"customer.subscription.pending_update_expired", KindSnapshot},
		{"subscription_schedule.created", KindSnapshot},
		{"subscription_schedule.updated", KindSnapshot},
		{"subscription_schedule.expiring", KindSnapshot},
		{"subscription_schedule.released", KindSnapshot},
		{"subscription_schedule.canceled", KindSnapshot},
		{"subscription_schedule.completed", KindSnapshot},
		{"subscription_schedule.aborted", KindSnapshot},
	}
	for _, tc := range cases {
		t.Run(tc.eventType, func(t *testing.T) {
			if got := Route(tc.eventType, supported); got != (Routing{Kind: tc.want}) {
				t.Errorf("Route(%q) = %+v, want %+v", tc.eventType, got, Routing{Kind: tc.want})
			}
		})
	}
}

func TestRouteIgnoresTypesWithNoBusinessEffect(t *testing.T) {
	for _, eventType := range []string{"customer.subscription.created", "customer.created", "payment_intent.succeeded", "invoice.finalized"} {
		for _, version := range []string{"2026-08-26.dahlia", "2020-08-27", ""} {
			want := Routing{Kind: KindIgnore, Reason: ReasonUnsupportedEventType}
			if got := Route(eventType, version); got != want {
				t.Errorf("Route(%q, %q) = %+v, want %+v", eventType, version, got, want)
			}
		}
	}
}

func TestRouteEscalatesASupportedTypeOfAnUnsupportedVersion(t *testing.T) {
	for _, eventType := range []string{"invoice.paid", "checkout.session.completed", "charge.refunded", "customer.subscription.updated"} {
		for _, version := range []string{"2020-08-27", "2027-01-01.clover", ""} {
			want := Routing{Kind: KindEscalate, Reason: ReasonUnsupportedAPIVersion}
			if got := Route(eventType, version); got != want {
				t.Errorf("Route(%q, %q) = %+v, want %+v", eventType, version, got, want)
			}
		}
	}
}

func TestRouteAcceptsEveryAdaptedVersion(t *testing.T) {
	for _, version := range []string{"2026-07-29.dahlia", "2026-08-26.dahlia"} {
		if got := Route("invoice.paid", version); got != (Routing{Kind: KindInvoicePaid}) {
			t.Errorf("Route(invoice.paid, %q) = %+v, want KindInvoicePaid", version, got)
		}
	}
}
