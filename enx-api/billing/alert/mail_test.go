package alert

import (
	"strings"
	"testing"
	"time"
)

func assertLines(t *testing.T, text string, want []string) {
	t.Helper()
	for _, line := range want {
		if !strings.Contains(text, line+"\n") {
			t.Errorf("mail text lacks line %q:\n%s", line, text)
		}
	}
}

func TestEventAttentionMailNamesTheEventAndItsAdminRoute(t *testing.T) {
	m := EventAttention{
		AccountID:       "acct_1",
		Livemode:        false,
		EventID:         "evt_1",
		EventType:       "invoice.paid",
		Reason:          "attribution_deadline_passed",
		SubscriptionID:  "sub_1",
		CustomerID:      "cus_1",
		InvoiceID:       "in_1",
		PaymentIntentID: "pi_1",
		ChargeID:        "ch_1",
	}.Mail()

	if want := "Catglish billing: Stripe event evt_1 needs attention (attribution_deadline_passed)"; m.Subject != want {
		t.Errorf("Subject = %q, want %q", m.Subject, want)
	}
	assertLines(t, m.Text, []string{
		"Event: evt_1",
		"Type: invoice.paid",
		"Reason: attribution_deadline_passed",
		"Stripe account: acct_1 (test mode)",
		"Subscription: sub_1",
		"Customer: cus_1",
		"Invoice: in_1",
		"Payment intent: pi_1",
		"Charge: ch_1",
		"Inspect: GET /api/admin/webhook-events/evt_1",
	})
}

func TestEventAttentionMailLeavesOutReferencesTheEventLacks(t *testing.T) {
	m := EventAttention{AccountID: "acct_1", Livemode: true, EventID: "evt_2", EventType: "charge.refunded", Reason: "unmatched_refund", ChargeID: "ch_2"}.Mail()

	assertLines(t, m.Text, []string{"Stripe account: acct_1 (live mode)", "Charge: ch_2"})
	for _, label := range []string{"Subscription:", "Customer:", "Invoice:", "Payment intent:"} {
		if strings.Contains(m.Text, label) {
			t.Errorf("mail text names %q although the event has none:\n%s", label, m.Text)
		}
	}
}

func TestConflictMailNamesBothSubscriptionsAndTheResolveRoute(t *testing.T) {
	m := ConflictFound{
		AccountID:              "acct_1",
		Livemode:               true,
		SubscriptionID:         "sub_B",
		AcceptedSubscriptionID: "sub_A",
		OwnerID:                "u1",
		CustomerID:             "cus_B",
		Reason:                 "competing_live_subscription",
		DiscoveredAt:           time.Date(2026, 10, 24, 9, 0, 0, 0, time.FixedZone("PDT", -7*3600)),
	}.Mail()

	if want := "Catglish billing: subscription conflict sub_B"; m.Subject != want {
		t.Errorf("Subject = %q, want %q", m.Subject, want)
	}
	assertLines(t, m.Text, []string{
		"Conflicting subscription: sub_B",
		"Accepted subscription: sub_A",
		"User: u1",
		"Customer: cus_B",
		"Reason: competing_live_subscription",
		"Stripe account: acct_1 (live mode)",
		"Discovered (UTC): 2026-10-24T16:00:00Z",
		"Inspect: GET /api/admin/subscription-conflicts/sub_B",
		`Resolve: PATCH /api/admin/subscription-conflicts/sub_B with {"status":"resolved","notes":"..."}`,
	})
}

func TestSupportMailPointsToTheSavedRequest(t *testing.T) {
	m := SupportRequested{
		SubscriptionID: "sub_B",
		OwnerID:        "u1",
		RequestedAt:    time.Date(2026, 10, 24, 9, 30, 0, 0, time.UTC),
	}.Mail()

	if want := "Catglish billing: support request on subscription conflict sub_B"; m.Subject != want {
		t.Errorf("Subject = %q, want %q", m.Subject, want)
	}
	assertLines(t, m.Text, []string{
		"Conflicting subscription: sub_B",
		"User: u1",
		"Sent (UTC): 2026-10-24T09:30:00Z",
		"Inspect: GET /api/admin/subscription-conflicts/sub_B",
	})
}

func TestAlertMailsSayENXTookNoFinancialAction(t *testing.T) {
	mails := map[string]Mail{
		"event attention": EventAttention{EventID: "evt_1", EventType: "invoice.paid", Reason: "r"}.Mail(),
		"conflict":        ConflictFound{SubscriptionID: "sub_B"}.Mail(),
		"support":         SupportRequested{SubscriptionID: "sub_B"}.Mail(),
	}
	for name, m := range mails {
		if !strings.Contains(m.Text, NoActionTaken) {
			t.Errorf("%s mail does not say ENX took no financial action:\n%s", name, m.Text)
		}
	}
}
