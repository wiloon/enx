//go:build integration

package repo

import (
	"context"
	"errors"
	"testing"
	"time"

	"enx-api/billing/acceptance"
	"enx-api/billing/alert"
	"enx-api/billing/creditperiod"
	"enx-api/billing/invoice"
	"enx-api/billing/invoicepaid"
	"enx-api/billing/webhookevent"
	"enx-api/referral"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

func applyInvoice(t *testing.T, eventID string, e invoicepaid.Effects) error {
	t.Helper()
	return sqlitex.DB.Transaction(func(tx *gorm.DB) error {
		return WebhookEffects{Now: func() time.Time { return receiptT0 }, Referral: referralTerms}.
			Apply(tx, eventScope(eventID), e)
	})
}

var periodOne = invoice.Period{Start: 1790000000, End: 1792592000}

// normalGrantEffects accepts sub_new for u_topup at the observed revision.
func normalGrantEffects(revision int64, invoiceID string) invoicepaid.Effects {
	return invoicepaid.Effects{
		Observed: invoicepaid.Observed{
			SubscriptionID: "sub_new", SubscriptionKnown: true, SubscriptionVersion: 1, OwnerUserID: "u_topup", Revision: revision,
		},
		Classification: &invoicepaid.Classification{To: acceptance.Accepted},
		Grant: &invoicepaid.Grant{
			Kind: invoicepaid.NormalGrant, InvoiceID: invoiceID, PaymentIntentID: "pi_" + invoiceID, Tier: "pro",
			Source: creditperiod.Source{SubscriptionID: "sub_new", Period: periodOne}, Purchased: 1000, Applied: 1000,
		},
		FirstPayment: &referral.FirstPayment{
			Kind: referral.KindSubscription, PaymentIntentID: "pi_" + invoiceID, InvoiceID: invoiceID, Credits: 1000, PaidAt: receiptT0,
		},
	}
}

// newInvoiceDB seeds u_topup with an unclassified, ownerless-checkout row of
// sub_new (version 1) owned by u_topup.
func newInvoiceDB(t *testing.T, fixtures ...string) {
	t.Helper()
	newCheckoutDB(t, append([]string{"topup-only.sql"}, fixtures...)...)
	seedSubscription(t, subscriptionRow{ID: "sub_new", UserID: "u_topup", CustomerID: "cus_topup", Status: "active"})
}

func poolBalanceOf(t *testing.T, userID string) int64 {
	t.Helper()
	return readBalances(t, userID).SubscriptionBalance
}

type invoiceGrantRow struct {
	Type, GrantKind, StripeInvoiceID, StripeSubscriptionID, FromTier, Tier string
	Amount, BalanceAfter, PeriodStart, PeriodEnd, Purchased, Applied       int64
	StripeEventID, StripePaymentIntentID                                   string
}

func subscriptionGrants(t *testing.T, userID string) []invoiceGrantRow {
	t.Helper()
	var rows []invoiceGrantRow
	if err := sqlitex.DB.Raw("SELECT type, grant_kind, COALESCE(stripe_invoice_id, '') AS stripe_invoice_id, "+
		"COALESCE(stripe_subscription_id, '') AS stripe_subscription_id, from_tier, tier, amount, balance_after, "+
		"COALESCE(period_start, 0) AS period_start, COALESCE(period_end, 0) AS period_end, COALESCE(purchased, -1) AS purchased, "+
		"COALESCE(applied, -1) AS applied, COALESCE(stripe_event_id, '') AS stripe_event_id, "+
		"COALESCE(stripe_payment_intent_id, '') AS stripe_payment_intent_id FROM credit_transactions "+
		"WHERE user_id = ? AND type = 'GRANT_SUBSCRIPTION' AND stripe_invoice_id IS NOT NULL ORDER BY created_at, rowid", userID).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestInvoicePaidStoreReadsTheSubscriptionOwnerPoolAndGrants(t *testing.T) {
	newCheckoutDB(t, "subscribed.sql")
	seedCheckoutEvent(t, "evt_co", "cs_sub", "sub_subscribed", "processed", checkoutPayload("cs_sub", "u_subscribed", "sub_subscribed"))
	execAll(t,
		"UPDATE credit_transactions SET stripe_invoice_id = 'in_old', stripe_subscription_id = 'sub_subscribed', period_start = 1,"+
			" period_end = 1800000000, grant_kind = 'normal_period', applied = 400 WHERE id = 'tx_subscribed_grant'",
		"UPDATE users SET billing_version = 5 WHERE id = 'u_subscribed'",
	)
	store := InvoicePaid{}
	ctx := context.Background()

	if rec, err := store.InvoiceRecorded(ctx, "in_old"); err != nil || !rec {
		t.Errorf("InvoiceRecorded(in_old) = %t, %v; want true", rec, err)
	}
	if rec, err := store.InvoiceRecorded(ctx, "in_new"); err != nil || rec {
		t.Errorf("InvoiceRecorded(in_new) = %t, %v; want false", rec, err)
	}

	sub, err := store.Subscription(ctx, "sub_subscribed")
	want := invoicepaid.Subscription{Known: true, OwnerUserID: "u_subscribed", CheckoutUserID: "u_subscribed", Classification: acceptance.Accepted, Version: 1}
	if err != nil || sub != want {
		t.Errorf("Subscription = %+v, %v; want %+v", sub, err, want)
	}
	if sub, err := store.Subscription(ctx, "sub_none"); err != nil || sub != (invoicepaid.Subscription{}) {
		t.Errorf("Subscription(sub_none) = %+v, %v; want unknown", sub, err)
	}

	o, err := store.Owner(ctx, "u_subscribed")
	if err != nil || o.AcceptedID != "sub_subscribed" || o.Revision != 5 || o.Deletion != acceptance.NoDeletion || len(o.Owned) != 1 {
		t.Fatalf("Owner = %+v, %v", o, err)
	}
	wantPool := creditperiod.Pool{Source: creditperiod.Source{SubscriptionID: "sub_subscribed", Period: invoice.Period{Start: 1, End: 1800000000}}}
	if o.Pool != wantPool {
		t.Errorf("Pool = %+v, want %+v", o.Pool, wantPool)
	}
	if o, err := store.Owner(ctx, "u_gone"); err != nil || o.Deletion != acceptance.DeletionCompleted {
		t.Errorf("Owner(u_gone) = %+v, %v; want the deletion completed", o, err)
	}

	g, err := store.NormalGrantEndingAt(ctx, "sub_subscribed", 1800000000)
	if err != nil || g == nil || g.Applied != 400 || g.Source.SubscriptionID != "sub_subscribed" {
		t.Errorf("NormalGrantEndingAt = %+v, %v; want the stored grant applying 400", g, err)
	}
	if g, err := store.NormalGrantEndingAt(ctx, "sub_subscribed", 1); err != nil || g != nil {
		t.Errorf("NormalGrantEndingAt(other period) = %+v, %v; want none", g, err)
	}

	if _, err := store.Payload(ctx, eventScope("evt_co")); err != nil {
		t.Errorf("Payload: %v", err)
	}
}

func TestApplyInvoicePaidAcceptsAndGrantsANormalPeriodOnce(t *testing.T) {
	newInvoiceDB(t)
	execAll(t, "UPDATE credit_accounts SET subscription_balance = 40 WHERE user_id = 'u_topup'")

	if err := applyInvoice(t, "evt_a", normalGrantEffects(0, "in_1")); err != nil {
		t.Fatalf("apply: %v", err)
	}

	if got := poolBalanceOf(t, "u_topup"); got != 1000 {
		t.Errorf("subscription balance = %d, want it reset to 1000", got)
	}
	rows := subscriptionGrants(t, "u_topup")
	want := invoiceGrantRow{
		Type: "GRANT_SUBSCRIPTION", GrantKind: "normal_period", StripeInvoiceID: "in_1", StripeSubscriptionID: "sub_new", Tier: "pro",
		Amount: 1000, BalanceAfter: 1000, PeriodStart: periodOne.Start, PeriodEnd: periodOne.End, Purchased: 1000, Applied: 1000,
		StripeEventID: "evt_a", StripePaymentIntentID: "pi_in_1",
	}
	if len(rows) != 1 || rows[0] != want {
		t.Fatalf("ledger = %+v, want [%+v]", rows, want)
	}
	var row struct {
		Class, Accepted, PoolGrant string
		PeriodEnd                  int64
		Version                    int64
	}
	if err := sqlitex.DB.Raw("SELECT s.classification AS class, COALESCE(u.accepted_subscription_id, '') AS accepted, " +
		"COALESCE(a.pool_grant_id, '') AS pool_grant, COALESCE(a.period_end, 0) AS period_end, s.version " +
		"FROM subscriptions s, users u, credit_accounts a WHERE s.stripe_subscription_id = 'sub_new' AND u.id = 'u_topup' AND a.user_id = 'u_topup'").
		Scan(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Class != "accepted" || row.Accepted != "sub_new" || row.PoolGrant == "" || row.PeriodEnd != periodOne.End || row.Version != 2 {
		t.Errorf("state = %+v; want accepted, pointed at, pool grant set, period end %d, version 2", row, periodOne.End)
	}
	if v := billingVersion(t, "u_topup"); v != 1 {
		t.Errorf("billing_version = %d, want 1", v)
	}
}

func TestApplyInvoicePaidHandsTheFirstPaymentOver(t *testing.T) {
	newInvoiceDB(t)
	execAll(t, "INSERT INTO users (id, clerk_user_id, name, email, status) VALUES ('u_ref', 'c_ref', 'Ref', 'r@example.com', 'active')")
	if _, err := (Referrals{}).Insert(context.Background(), referral.Referral{
		InviteeID: "u_topup", ReferrerID: "u_ref", Code: "AAAAAAAA", ClaimedAt: receiptT0, Status: referral.StatusClaimed,
	}); err != nil {
		t.Fatal(err)
	}

	if err := applyInvoice(t, "evt_a", normalGrantEffects(0, "in_1")); err != nil {
		t.Fatalf("apply: %v", err)
	}

	r, ok, err := Referrals{}.Get(context.Background(), "u_topup")
	if err != nil || !ok || r.FirstPayment == nil || r.FirstPayment.InvoiceID != "in_1" {
		t.Errorf("referral = %+v, %t, %v; want the first payment of in_1 recorded", r, ok, err)
	}
}

func TestApplyInvoicePaidAddsAnUpgradeTopUpAndKeepsThePoolProvenance(t *testing.T) {
	newInvoiceDB(t)
	if err := applyInvoice(t, "evt_a", normalGrantEffects(0, "in_1")); err != nil {
		t.Fatalf("first apply: %v", err)
	}
	var poolGrant string
	if err := sqlitex.DB.Raw("SELECT pool_grant_id FROM credit_accounts WHERE user_id = 'u_topup'").Scan(&poolGrant).Error; err != nil {
		t.Fatal(err)
	}
	e := invoicepaid.Effects{
		Observed: invoicepaid.Observed{SubscriptionID: "sub_new", SubscriptionKnown: true, SubscriptionVersion: 2, OwnerUserID: "u_topup", AcceptedID: "sub_new", Revision: 1},
		Grant: &invoicepaid.Grant{
			Kind: invoicepaid.UpgradeTopUp, InvoiceID: "in_up", PaymentIntentID: "pi_up", FromTier: "pro", Tier: "max",
			Source: creditperiod.Source{SubscriptionID: "sub_new", Period: periodOne}, Purchased: 2000, Applied: 1500,
		},
	}

	if err := applyInvoice(t, "evt_b", e); err != nil {
		t.Fatalf("upgrade apply: %v", err)
	}

	if got := poolBalanceOf(t, "u_topup"); got != 2500 {
		t.Errorf("subscription balance = %d, want 1000 + 1500", got)
	}
	rows := subscriptionGrants(t, "u_topup")
	if len(rows) != 2 || rows[1].GrantKind != "upgrade_top_up" || rows[1].FromTier != "pro" || rows[1].Tier != "max" ||
		rows[1].Amount != 1500 || rows[1].Applied != 1500 || rows[1].Purchased != 2000 || rows[1].BalanceAfter != 2500 ||
		rows[1].StripeSubscriptionID != "sub_new" || rows[1].PeriodEnd != periodOne.End {
		t.Errorf("ledger = %+v; want the upgrade top-up recorded after the normal grant", rows)
	}
	var after string
	if err := sqlitex.DB.Raw("SELECT pool_grant_id FROM credit_accounts WHERE user_id = 'u_topup'").Scan(&after).Error; err != nil || after != poolGrant {
		t.Errorf("pool_grant_id = %q, %v; want it unchanged (%q)", after, err, poolGrant)
	}
	if v := billingVersion(t, "u_topup"); v != 2 {
		t.Errorf("billing_version = %d, want 2: a stored grant's Source is read by credit decisions", v)
	}
}

func TestApplyInvoicePaidRecordsAZeroEffectGrantWithoutTouchingThePool(t *testing.T) {
	newInvoiceDB(t)
	execAll(t, "UPDATE credit_accounts SET subscription_balance = 700 WHERE user_id = 'u_topup'")
	e := normalGrantEffects(0, "in_late")
	e.Classification = nil
	e.Observed.AcceptedID = ""
	e.Grant.Applied = 0
	e.FirstPayment = nil

	if err := applyInvoice(t, "evt_a", e); err != nil {
		t.Fatalf("apply: %v", err)
	}

	if got := poolBalanceOf(t, "u_topup"); got != 700 {
		t.Errorf("subscription balance = %d, want it left at 700", got)
	}
	rows := subscriptionGrants(t, "u_topup")
	if len(rows) != 1 || rows[0].Amount != 0 || rows[0].Applied != 0 || rows[0].Purchased != 1000 || rows[0].BalanceAfter != 700 {
		t.Errorf("ledger = %+v; want one row of purchased 1000, applied 0", rows)
	}
	var poolGrant *string
	if err := sqlitex.DB.Raw("SELECT pool_grant_id FROM credit_accounts WHERE user_id = 'u_topup'").Scan(&poolGrant).Error; err != nil {
		t.Fatal(err)
	}
	if poolGrant != nil && *poolGrant == rows2ID(t, "in_late") {
		t.Errorf("pool_grant_id moved to the zero-effect grant")
	}
}

func rows2ID(t *testing.T, invoiceID string) string {
	t.Helper()
	var id string
	if err := sqlitex.DB.Raw("SELECT id FROM credit_transactions WHERE stripe_invoice_id = ?", invoiceID).Scan(&id).Error; err != nil {
		t.Fatal(err)
	}
	return id
}

func TestApplyInvoicePaidReplayUnderAnotherEventIDDoesNotDuplicateTheEffects(t *testing.T) {
	newInvoiceDB(t)
	if err := applyInvoice(t, "evt_a", normalGrantEffects(0, "in_1")); err != nil {
		t.Fatalf("first apply: %v", err)
	}

	// evt_b decided before evt_a committed, so it holds the old observations.
	err := applyInvoice(t, "evt_b", normalGrantEffects(0, "in_1"))
	if !errors.Is(err, invoicepaid.ErrStale) {
		t.Fatalf("replay = %v, want ErrStale", err)
	}
	// Decided after the commit, at the new revision: the invoice recheck still stops it.
	e := normalGrantEffects(billingVersion(t, "u_topup"), "in_1")
	e.Observed.SubscriptionVersion = 2
	e.Observed.AcceptedID = "sub_new"
	e.Classification = nil
	if err := applyInvoice(t, "evt_c", e); !errors.Is(err, invoicepaid.ErrStale) {
		t.Fatalf("late replay = %v, want ErrStale", err)
	}

	if rows := subscriptionGrants(t, "u_topup"); len(rows) != 1 {
		t.Errorf("grants = %d, want 1", len(rows))
	}
	if got := poolBalanceOf(t, "u_topup"); got != 1000 {
		t.Errorf("subscription balance = %d, want 1000", got)
	}
}

func TestApplyInvoicePaidCompetingAcceptancesLeaveOneAcceptedSubscription(t *testing.T) {
	newInvoiceDB(t)
	seedSubscription(t, subscriptionRow{ID: "sub_rival", UserID: "u_topup", CustomerID: "cus_rival", Status: "active"})
	rival := normalGrantEffects(0, "in_rival")
	rival.Observed.SubscriptionID = "sub_rival"
	rival.Grant.Source.SubscriptionID = "sub_rival"

	if err := applyInvoice(t, "evt_a", normalGrantEffects(0, "in_1")); err != nil {
		t.Fatalf("first apply: %v", err)
	}
	if err := applyInvoice(t, "evt_b", rival); !errors.Is(err, invoicepaid.ErrStale) {
		t.Fatalf("rival apply = %v, want ErrStale", err)
	}

	var accepted int64
	if err := sqlitex.DB.Raw("SELECT count(*) FROM subscriptions WHERE user_id = 'u_topup' AND classification = 'accepted'").Scan(&accepted).Error; err != nil || accepted != 1 {
		t.Errorf("accepted subscriptions = %d, %v; want 1", accepted, err)
	}
	var pointer string
	if err := sqlitex.DB.Raw("SELECT accepted_subscription_id FROM users WHERE id = 'u_topup'").Scan(&pointer).Error; err != nil || pointer != "sub_new" {
		t.Errorf("accepted pointer = %q, %v; want sub_new", pointer, err)
	}
}

func TestApplyInvoicePaidCommitsNothingWhenWhatItReadMovedOn(t *testing.T) {
	cases := []struct {
		name, setup string
	}{
		{"the owner's billing revision moved", "UPDATE users SET billing_version = 3 WHERE id = 'u_topup'"},
		{"the owner's accepted pointer moved", "UPDATE users SET accepted_subscription_id = 'sub_other' WHERE id = 'u_topup'"},
		{"the subscription row moved", "UPDATE subscriptions SET version = 2 WHERE stripe_subscription_id = 'sub_new'"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			newInvoiceDB(t)
			execAll(t, tc.setup)

			if err := applyInvoice(t, "evt_a", normalGrantEffects(0, "in_1")); !errors.Is(err, invoicepaid.ErrStale) {
				t.Fatalf("apply = %v, want ErrStale", err)
			}
			if rows := subscriptionGrants(t, "u_topup"); len(rows) != 0 {
				t.Errorf("grants = %+v, want none", rows)
			}
			if got := poolBalanceOf(t, "u_topup"); got != 0 {
				t.Errorf("subscription balance = %d, want 0", got)
			}
		})
	}
}

func TestApplyInvoicePaidMarksAConflictWithItsPendingAlertAndGrantsNothing(t *testing.T) {
	newInvoiceDB(t)
	discovered := receiptT0
	e := invoicepaid.Effects{
		Observed: invoicepaid.Observed{SubscriptionID: "sub_new", SubscriptionKnown: true, SubscriptionVersion: 1, OwnerUserID: "u_topup", Revision: 0},
		Classification: &invoicepaid.Classification{
			To: acceptance.Conflict, ConflictReason: "second_live_subscription", ConflictWith: "sub_a",
			DiscoveredAt: discovered, Alert: alert.Raise(alert.Alert{}, discovered),
		},
	}

	if err := applyInvoice(t, "evt_a", e); err != nil {
		t.Fatalf("apply: %v", err)
	}

	var row struct {
		Class, Reason, With, Status, AlertState string
		DiscoveredAt                            int64
		Version                                 int64
	}
	if err := sqlitex.DB.Raw("SELECT classification AS class, conflict_reason AS reason, conflict_with_subscription_id AS `with`, " +
		"conflict_status AS status, conflict_alert_state AS alert_state, COALESCE(conflict_discovered_at, 0) AS discovered_at, version " +
		"FROM subscriptions WHERE stripe_subscription_id = 'sub_new'").Scan(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Class != "conflict" || row.Reason != "second_live_subscription" || row.With != "sub_a" || row.Status != "open" ||
		row.AlertState != string(alert.Pending) || row.DiscoveredAt != discovered.UnixMilli() || row.Version != 2 {
		t.Errorf("row = %+v; want an open conflict with a pending alert", row)
	}
	var pointer *string
	if err := sqlitex.DB.Raw("SELECT accepted_subscription_id FROM users WHERE id = 'u_topup'").Scan(&pointer).Error; err != nil || pointer != nil {
		t.Errorf("accepted pointer = %v, %v; want it untouched", pointer, err)
	}
	if rows := subscriptionGrants(t, "u_topup"); len(rows) != 0 {
		t.Errorf("grants = %+v, want none", rows)
	}
}

func TestApplyInvoicePaidMarksAStaleSubscription(t *testing.T) {
	newInvoiceDB(t)
	e := invoicepaid.Effects{
		Observed:       invoicepaid.Observed{SubscriptionID: "sub_new", SubscriptionKnown: true, SubscriptionVersion: 1, OwnerUserID: "u_topup"},
		Classification: &invoicepaid.Classification{To: acceptance.Stale},
	}

	if err := applyInvoice(t, "evt_a", e); err != nil {
		t.Fatalf("apply: %v", err)
	}

	var class string
	if err := sqlitex.DB.Raw("SELECT classification FROM subscriptions WHERE stripe_subscription_id = 'sub_new'").Scan(&class).Error; err != nil || class != "stale" {
		t.Errorf("classification = %q, %v; want stale", class, err)
	}
}

func TestApplyInvoicePaidAttributesAnUnownedSubscriptionAndRetainsTheCustomer(t *testing.T) {
	newCheckoutDB(t, "topup-only.sql")
	execAll(t, "INSERT INTO subscriptions (stripe_subscription_id, stripe_customer_id, status, created_at, updated_at) VALUES ('sub_free', 'cus_free', 'none', 1, 1)")
	e := invoicepaid.Effects{
		Observed:    invoicepaid.Observed{SubscriptionID: "sub_free", SubscriptionKnown: true, SubscriptionVersion: 1, OwnerUserID: "u_topup"},
		Attribution: &invoicepaid.Attribution{UserID: "u_topup", CustomerID: "cus_free"},
	}

	if err := applyInvoice(t, "evt_a", e); err != nil {
		t.Fatalf("apply: %v", err)
	}

	got, ok := readSnapshot(t, "sub_free")
	if !ok || got.Unowned {
		t.Errorf("row = %+v, %t; want it owned", got, ok)
	}
	if owner, _ := (CheckoutCompleted{}).CustomerOwner(context.Background(), "cus_free"); owner != "u_topup" {
		t.Errorf("owner of cus_free = %q, want u_topup", owner)
	}
}

func TestApplyInvoicePaidAttributionDoesNotOverwriteACustomerOwner(t *testing.T) {
	newCheckoutDB(t, "topup-only.sql")
	execAll(t,
		"INSERT INTO subscriptions (stripe_subscription_id, stripe_customer_id, status, created_at, updated_at) VALUES ('sub_free', 'cus_free', 'none', 1, 1)",
		"INSERT INTO stripe_customers (stripe_customer_id, user_id, created_at) VALUES ('cus_free', 'u_else', 1)",
	)
	e := invoicepaid.Effects{
		Observed:    invoicepaid.Observed{SubscriptionID: "sub_free", SubscriptionKnown: true, SubscriptionVersion: 1, OwnerUserID: "u_topup"},
		Attribution: &invoicepaid.Attribution{UserID: "u_topup", CustomerID: "cus_free"},
	}

	_ = applyInvoice(t, "evt_a", e)

	if owner, _ := (CheckoutCompleted{}).CustomerOwner(context.Background(), "cus_free"); owner != "u_else" {
		t.Errorf("owner of cus_free = %q, want it left with u_else", owner)
	}
}

func TestApplyInvoicePaidCreatesTheUnknownSubscriptionOfADeletedPayerWithoutTheUser(t *testing.T) {
	newCheckoutDB(t, "topup-only.sql")
	execAll(t,
		"INSERT INTO account_deletion_gates (user_id, state, started_at, updated_at) VALUES ('u_topup', 'deleted', 1, 1)",
		"DELETE FROM credit_accounts WHERE user_id = 'u_topup'", "DELETE FROM users WHERE id = 'u_topup'",
	)
	e := invoicepaid.Effects{
		Observed:    invoicepaid.Observed{SubscriptionID: "sub_late", OwnerUserID: "u_topup"},
		Attribution: &invoicepaid.Attribution{UserID: "u_topup", CustomerID: "cus_late"},
	}

	if err := applyInvoice(t, "evt_a", e); err != nil {
		t.Fatalf("apply: %v", err)
	}

	got, ok := readSnapshot(t, "sub_late")
	if !ok || got.Unowned || got.StripeCustomerID != "cus_late" {
		t.Errorf("row = %+v, %t; want it retained and owned", got, ok)
	}
	if n := countRows(t, "users", "id", "u_topup"); n != 0 {
		t.Errorf("users = %d, want the user not recreated", n)
	}
}

func TestApplyInvoicePaidDeletionBarriersPreventNewEntitlement(t *testing.T) {
	for _, state := range []string{"in_progress", "deleted"} {
		t.Run(state, func(t *testing.T) {
			newInvoiceDB(t)
			execAll(t, "INSERT INTO account_deletion_gates (user_id, state, started_at, updated_at) VALUES ('u_topup', '"+state+"', 1, 1)")

			if err := applyInvoice(t, "evt_a", normalGrantEffects(0, "in_1")); !errors.Is(err, invoicepaid.ErrStale) {
				t.Fatalf("apply = %v, want ErrStale", err)
			}
			if rows := subscriptionGrants(t, "u_topup"); len(rows) != 0 {
				t.Errorf("grants = %+v, want none", rows)
			}
			var class string
			if err := sqlitex.DB.Raw("SELECT classification FROM subscriptions WHERE stripe_subscription_id = 'sub_new'").Scan(&class).Error; err != nil || class != "" {
				t.Errorf("classification = %q, %v; want it unclassified", class, err)
			}
		})
	}
}

func TestWebhookEventsSaveRollsTheTaskBackWhenAnInvoiceEffectFails(t *testing.T) {
	newInvoiceDB(t)
	// The zero WebhookEffects has no referral policy, so the first-payment
	// handoff fails after the grant was written.
	store := NewWebhookEvents(ApplyWebhookEffects)
	read := claimedTask(t, store)
	next := read
	next.Status = webhookevent.Processed

	if err := store.Save(context.Background(), sandboxScope, read, next, normalGrantEffects(0, "in_1")); err == nil {
		t.Fatal("Save = nil, want the failed handoff")
	}

	if got := poolBalanceOf(t, "u_topup"); got != 0 {
		t.Errorf("subscription balance = %d, want the grant rolled back", got)
	}
	if rows := subscriptionGrants(t, "u_topup"); len(rows) != 0 {
		t.Errorf("grants = %+v, want none", rows)
	}
	var class string
	if err := sqlitex.DB.Raw("SELECT classification FROM subscriptions WHERE stripe_subscription_id = 'sub_new'").Scan(&class).Error; err != nil || class != "" {
		t.Errorf("classification = %q, %v; want the acceptance rolled back", class, err)
	}
	if st := unfinished(t, store)["evt_1"].Task.Status; st == webhookevent.Processed {
		t.Errorf("task status = %s, want it not completed", st)
	}
}
