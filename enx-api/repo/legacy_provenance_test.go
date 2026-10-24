package repo

import (
	"context"
	"reflect"
	"testing"

	"enx-api/billing/creditperiod"
	"enx-api/billing/invoice"
	"enx-api/billing/legacyprovenance"
	"enx-api/utils/sqlitex"
)

func TestLegacyProvenanceUnrecordedListsTheGrantBehindEachMigratedSubscriptionsPool(t *testing.T) {
	newSubscriptionConflictDB(t, "subscribed.sql", "ended.sql", "overwritten-subscription.sql", "topup-only.sql", "deleted-user.sql")
	// A zero-amount grant has no PaymentIntent.
	if err := sqlitex.DB.Exec("UPDATE credit_transactions SET stripe_payment_intent_id = NULL WHERE id = 'tx_ended_grant'").Error; err != nil {
		t.Fatal(err)
	}

	got, err := LegacyProvenance{}.Unrecorded(context.Background())
	if err != nil {
		t.Fatalf("Unrecorded: %v", err)
	}
	// Not the overwritten subscription's older grant, the top-up, nor the
	// deleted user's grant, which supplies no pool.
	want := []legacyprovenance.Grant{
		{TransactionID: "tx_ended_grant", SubscriptionID: "sub_ended", PoolPeriodEnd: 1700000000},
		{TransactionID: "tx_overwritten_second", SubscriptionID: "sub_second", PoolPeriodEnd: 1800000000, PaymentIntentID: "pi_second"},
		{TransactionID: "tx_subscribed_grant", SubscriptionID: "sub_subscribed", PoolPeriodEnd: 1800000000, PaymentIntentID: "pi_subscribed"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Unrecorded = %+v, want %+v", got, want)
	}
}

func TestLegacyProvenanceUnrecordedSkipsAPoolWithNoAcceptedSubscriptionOrPeriod(t *testing.T) {
	newSubscriptionConflictDB(t, "subscribed.sql", "ended.sql", "deleted-user.sql")
	for _, stmt := range []string{
		"UPDATE users SET accepted_subscription_id = NULL WHERE id = 'u_ended'",
		"UPDATE credit_accounts SET period_end = NULL WHERE user_id = 'u_subscribed'",
		// A pool left behind by a deleted user, whose users row is gone.
		"INSERT INTO credit_accounts (user_id, subscription_balance, period_end, updated_at, pool_grant_id) " +
			"VALUES ('u_deleted', 100, 1700000000, 1790000000000, 'tx_deleted_grant')",
	} {
		if err := sqlitex.DB.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}

	got, err := LegacyProvenance{}.Unrecorded(context.Background())
	if err != nil || len(got) != 0 {
		t.Errorf("Unrecorded = %+v, %v; want none", got, err)
	}
}

// grantProvenance is a credit_transactions row's provenance and the values
// the backfill must leave alone.
type grantProvenance struct {
	GrantKind            string
	StripeInvoiceID      *string
	StripeSubscriptionID *string
	PeriodStart          *int64
	PeriodEnd            *int64
	WithoutPeriod        bool
	ProvenanceReason     string
	Amount               int64
	BalanceAfter         int64
	Purchased            *int64
	Applied              *int64
}

func readGrantProvenance(t *testing.T, id string) grantProvenance {
	t.Helper()
	var g grantProvenance
	if err := sqlitex.DB.Raw("SELECT grant_kind, stripe_invoice_id, stripe_subscription_id, period_start, period_end, "+
		"without_period, provenance_reason, amount, balance_after, purchased, applied FROM credit_transactions WHERE id = ?", id).
		Scan(&g).Error; err != nil {
		t.Fatal(err)
	}
	return g
}

func subscriptionBalance(t *testing.T, userID string) int64 {
	t.Helper()
	var b int64
	if err := sqlitex.DB.Raw("SELECT subscription_balance FROM credit_accounts WHERE user_id = ?", userID).Scan(&b).Error; err != nil {
		t.Fatal(err)
	}
	return b
}

func ptr[T any](v T) *T { return &v }

func TestLegacyProvenanceRecordPinsTheGrantToItsInvoiceAndPeriod(t *testing.T) {
	newSubscriptionConflictDB(t, "subscribed.sql")
	ctx := context.Background()
	store := LegacyProvenance{}
	grant := legacyprovenance.Grant{TransactionID: "tx_subscribed_grant", SubscriptionID: "sub_subscribed", PoolPeriodEnd: 1800000000, PaymentIntentID: "pi_subscribed"}
	pinned := legacyprovenance.Result{Pinned: true, InvoiceID: "in_subscribed",
		Source: creditperiod.Source{SubscriptionID: "sub_subscribed", Period: invoice.Period{Start: 1797400000, End: 1800000000}}}
	revision := ownerBillingVersion(t, "u_subscribed")

	if err := store.Record(ctx, grant, pinned); err != nil {
		t.Fatalf("Record: %v", err)
	}

	want := grantProvenance{GrantKind: "normal_period", StripeInvoiceID: ptr("in_subscribed"), StripeSubscriptionID: ptr("sub_subscribed"),
		PeriodStart: ptr[int64](1797400000), PeriodEnd: ptr[int64](1800000000), Amount: 500, BalanceAfter: 500}
	if got := readGrantProvenance(t, "tx_subscribed_grant"); !reflect.DeepEqual(got, want) {
		t.Errorf("grant = %+v, want %+v", got, want)
	}
	if b := subscriptionBalance(t, "u_subscribed"); b != 500 {
		t.Errorf("subscription_balance = %d, want unchanged 500", b)
	}
	// Credit decisions read the grant's Source under the owner's revision.
	if v := ownerBillingVersion(t, "u_subscribed"); v != revision+1 {
		t.Errorf("billing_version = %d, want %d", v, revision+1)
	}
	left, err := store.Unrecorded(ctx)
	if err != nil || len(left) != 0 {
		t.Errorf("Unrecorded after the record = %+v, %v; want none", left, err)
	}
}

func TestLegacyProvenanceRecordWithoutAPeriodKeepsTheSubscriptionPoolEndAndReason(t *testing.T) {
	newSubscriptionConflictDB(t, "overwritten-subscription.sql")
	grant := legacyprovenance.Grant{TransactionID: "tx_overwritten_second", SubscriptionID: "sub_second", PoolPeriodEnd: 1800000000, PaymentIntentID: "pi_second"}
	revision := ownerBillingVersion(t, "u_overwritten")

	if err := (LegacyProvenance{}).Record(context.Background(), grant, legacyprovenance.Result{Reason: legacyprovenance.ReasonAmbiguousInvoices}); err != nil {
		t.Fatalf("Record: %v", err)
	}

	want := grantProvenance{GrantKind: "normal_period", StripeSubscriptionID: ptr("sub_second"), PeriodEnd: ptr[int64](1800000000),
		WithoutPeriod: true, ProvenanceReason: "ambiguous_invoices", Amount: 900, BalanceAfter: 900}
	if got := readGrantProvenance(t, "tx_overwritten_second"); !reflect.DeepEqual(got, want) {
		t.Errorf("grant = %+v, want %+v", got, want)
	}
	if v := ownerBillingVersion(t, "u_overwritten"); v != revision+1 {
		t.Errorf("billing_version = %d, want %d", v, revision+1)
	}
	if got := readGrantProvenance(t, "tx_overwritten_first"); got.StripeSubscriptionID != nil || got.GrantKind != "" {
		t.Errorf("the older grant = %+v, want no provenance", got)
	}
}

func TestLegacyProvenanceRecordLeavesAGrantAnotherRunRecordedAlone(t *testing.T) {
	newSubscriptionConflictDB(t, "subscribed.sql")
	ctx := context.Background()
	store := LegacyProvenance{}
	grant := legacyprovenance.Grant{TransactionID: "tx_subscribed_grant", SubscriptionID: "sub_subscribed", PoolPeriodEnd: 1800000000, PaymentIntentID: "pi_subscribed"}
	pinned := legacyprovenance.Result{Pinned: true, InvoiceID: "in_subscribed",
		Source: creditperiod.Source{SubscriptionID: "sub_subscribed", Period: invoice.Period{Start: 1797400000, End: 1800000000}}}
	if err := store.Record(ctx, grant, pinned); err != nil {
		t.Fatalf("first Record: %v", err)
	}
	first := readGrantProvenance(t, "tx_subscribed_grant")
	revision := ownerBillingVersion(t, "u_subscribed")

	if err := store.Record(ctx, grant, legacyprovenance.Result{Reason: legacyprovenance.ReasonNoMatchingInvoice}); err != nil {
		t.Fatalf("second Record: %v", err)
	}
	if got := readGrantProvenance(t, "tx_subscribed_grant"); !reflect.DeepEqual(got, first) {
		t.Errorf("grant after the second Record = %+v, want unchanged %+v", got, first)
	}
	if v := ownerBillingVersion(t, "u_subscribed"); v != revision {
		t.Errorf("billing_version = %d after the second Record, want unchanged %d", v, revision)
	}
}

func TestLegacyProvenanceRecordRefusesWhatItCannotRecord(t *testing.T) {
	newSubscriptionConflictDB(t, "subscribed.sql", "topup-only.sql")
	grant := legacyprovenance.Grant{TransactionID: "tx_subscribed_grant", SubscriptionID: "sub_subscribed", PoolPeriodEnd: 1800000000, PaymentIntentID: "pi_subscribed"}
	period := invoice.Period{Start: 1797400000, End: 1800000000}

	for _, tc := range []struct {
		name  string
		grant legacyprovenance.Grant
		r     legacyprovenance.Result
	}{
		{"pinned to another subscription's invoice", grant,
			legacyprovenance.Result{Pinned: true, InvoiceID: "in_other", Source: creditperiod.Source{SubscriptionID: "sub_other", Period: period}}},
		{"pinned to another period", grant,
			legacyprovenance.Result{Pinned: true, InvoiceID: "in_next", Source: creditperiod.Source{SubscriptionID: "sub_subscribed", Period: invoice.Period{Start: 1800000000, End: 1802600000}}}},
		{"pinned to no invoice", grant,
			legacyprovenance.Result{Pinned: true, Source: creditperiod.Source{SubscriptionID: "sub_subscribed", Period: period}}},
		{"no period and no reason", grant, legacyprovenance.Result{}},
		{"a missing grant", legacyprovenance.Grant{TransactionID: "tx_missing", SubscriptionID: "sub_subscribed", PoolPeriodEnd: 1800000000},
			legacyprovenance.Result{Reason: legacyprovenance.ReasonNoMatchingInvoice}},
		{"a top-up", legacyprovenance.Grant{TransactionID: "tx_topup_grant", SubscriptionID: "sub_subscribed", PoolPeriodEnd: 1800000000},
			legacyprovenance.Result{Reason: legacyprovenance.ReasonNoMatchingInvoice}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := (LegacyProvenance{}).Record(context.Background(), tc.grant, tc.r); err == nil {
				t.Error("Record succeeded, want an error")
			}
		})
	}
	if got := readGrantProvenance(t, "tx_subscribed_grant"); got.StripeSubscriptionID != nil {
		t.Errorf("grant = %+v after the refused records, want no provenance", got)
	}
	if got := readGrantProvenance(t, "tx_topup_grant"); got.StripeSubscriptionID != nil {
		t.Errorf("top-up = %+v after the refused records, want no provenance", got)
	}
}

func TestLegacyProvenanceMarkDoneSetsTheMarkerTheWorkerWaitsFor(t *testing.T) {
	newSubscriptionConflictDB(t)
	ctx := context.Background()
	events := WebhookEvents{}
	if done, err := events.LegacyBackfillDone(ctx); err != nil || done {
		t.Fatalf("LegacyBackfillDone before = %v, %v; want false", done, err)
	}

	for range 2 {
		if err := (LegacyProvenance{}).MarkDone(ctx); err != nil {
			t.Fatalf("MarkDone: %v", err)
		}
	}
	if done, err := events.LegacyBackfillDone(ctx); err != nil || !done {
		t.Errorf("LegacyBackfillDone after = %v, %v; want true", done, err)
	}
}

// paidInvoices is the backfill's Stripe, holding paid invoices by the
// PaymentIntent that paid them.
type paidInvoices map[string][]invoice.Invoice

func (p paidInvoices) PaidInvoicesOfPaymentIntent(_ context.Context, id string) ([]invoice.Invoice, error) {
	return p[id], nil
}

func (p paidInvoices) PaidInvoicesOfSubscription(context.Context, string) ([]invoice.Invoice, error) {
	return nil, nil
}

func TestLegacyProvenanceBackfillRecordsEveryMigratedPoolsGrantThenMarksItselfDone(t *testing.T) {
	newSubscriptionConflictDB(t, "subscribed.sql", "overwritten-subscription.sql")
	ctx := context.Background()
	cycle := func(id, sub string, p invoice.Period) invoice.Invoice {
		return invoice.Invoice{ID: id, SubscriptionID: sub, LinesComplete: true,
			Lines: []invoice.Line{{ID: "il_" + id, SubscriptionID: sub, Period: p}}}
	}
	period := invoice.Period{Start: 1797400000, End: 1800000000}
	// sub_second's pool grant was paid by an invoice of the overwritten
	// sub_first, so Stripe cannot pin it to sub_second.
	stripe := paidInvoices{
		"pi_subscribed": {cycle("in_subscribed", "sub_subscribed", period)},
		"pi_second":     {cycle("in_first", "sub_first", period)},
	}

	report, err := legacyprovenance.NewBackfill(LegacyProvenance{}, stripe).Run(ctx)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if report != (legacyprovenance.Report{Pinned: 1, WithoutPeriod: 1}) {
		t.Errorf("report = %+v, want one pinned and one without a period", report)
	}
	if got := readGrantProvenance(t, "tx_subscribed_grant"); got.StripeInvoiceID == nil || *got.StripeInvoiceID != "in_subscribed" {
		t.Errorf("tx_subscribed_grant = %+v, want pinned to in_subscribed", got)
	}
	if got := readGrantProvenance(t, "tx_overwritten_second"); !got.WithoutPeriod || got.ProvenanceReason != legacyprovenance.ReasonNoMatchingInvoice {
		t.Errorf("tx_overwritten_second = %+v, want without a period, reason %s", got, legacyprovenance.ReasonNoMatchingInvoice)
	}
	if done, err := (WebhookEvents{}).LegacyBackfillDone(ctx); err != nil || !done {
		t.Errorf("LegacyBackfillDone = %v, %v; want true", done, err)
	}
	again, err := legacyprovenance.NewBackfill(LegacyProvenance{}, stripe).Run(ctx)
	if err != nil || again != (legacyprovenance.Report{}) {
		t.Errorf("a second Run = %+v, %v; want nothing left to record", again, err)
	}
}
