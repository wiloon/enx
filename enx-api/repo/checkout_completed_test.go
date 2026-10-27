package repo

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"enx-api/billing/acceptance"
	"enx-api/billing/checkoutcompleted"
	"enx-api/billing/webhookevent"
	"enx-api/referral"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// seedCheckoutEvent stores a received checkout.session.completed event with
// its first delivery's payload, in the given task status.
func seedCheckoutEvent(t *testing.T, eventID, sessionID, subscriptionID, status, payload string) {
	t.Helper()
	execAll(t,
		"INSERT INTO stripe_webhook_deliveries (id, received_at, stripe_account_id, livemode, event_id, event_type, event_created, payload) "+
			"VALUES ('dlv_"+eventID+"', 1790000000000, 'acct_sandbox', 0, '"+eventID+"', 'checkout.session.completed', 1790000000, '"+payload+"')",
		"INSERT INTO stripe_webhook_events (stripe_account_id, livemode, event_id, type, created, first_delivery_id, first_received_at, "+
			"subscription_id, checkout_session_id, status, updated_at) VALUES ('acct_sandbox', 0, '"+eventID+"', 'checkout.session.completed', "+
			"1790000000, 'dlv_"+eventID+"', 1790000000000, '"+subscriptionID+"', '"+sessionID+"', '"+status+"', 1790000000000)",
	)
}

func checkoutPayload(sessionID, userID, subscriptionID string) string {
	return `{"id":"evt","object":"event","type":"checkout.session.completed","created":1790000000,"api_version":"2026-08-26.dahlia","livemode":false,` +
		`"data":{"object":{"object":"checkout.session","id":"` + sessionID + `","client_reference_id":"` + userID + `","mode":"subscription","subscription":"` + subscriptionID + `","customer":"cus_x"}}}`
}

func applyCheckout(t *testing.T, eventID string, e checkoutcompleted.Effects) error {
	t.Helper()
	return sqlitex.DB.Transaction(func(tx *gorm.DB) error {
		return WebhookEffects{Now: func() time.Time { return receiptT0 }, Referral: referralTerms}.
			Apply(tx, eventScope(eventID), e)
	})
}

var referralTerms = referral.FixedPolicy{ReferrerRewardTopupPercent: 10, RewardDelay: time.Hour}

func topUpEffects(revision int64, sessionID string) checkoutcompleted.Effects {
	return checkoutcompleted.Effects{
		Observed: checkoutcompleted.Observed{UserID: "u_topup", Revision: revision, CustomerID: "cus_topup", CustomerOwner: "u_topup"},
		TopUp:    &checkoutcompleted.TopUp{CheckoutSessionID: sessionID, PaymentIntentID: "pi_" + sessionID, UserID: "u_topup", Tier: "small", Credits: 500},
		FirstPayment: &referral.FirstPayment{
			Kind: referral.KindTopup, PaymentIntentID: "pi_" + sessionID, Credits: 500, PaidAt: receiptT0,
		},
	}
}

func topUpGrants(t *testing.T, userID string) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Raw("SELECT count(*) FROM credit_transactions WHERE type = 'GRANT_TOPUP' AND user_id = ?", userID).Scan(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

func billingVersion(t *testing.T, userID string) int64 {
	t.Helper()
	var v int64
	if err := sqlitex.DB.Raw("SELECT billing_version FROM users WHERE id = ?", userID).Scan(&v).Error; err != nil {
		t.Fatal(err)
	}
	return v
}

func newCheckoutDB(t *testing.T, fixtures ...string) {
	t.Helper()
	newSubscriptionConflictDB(t, fixtures...)
	if err := sqlitex.DB.AutoMigrate(&sqlitex.Referral{}); err != nil {
		t.Fatal(err)
	}
}

func TestCheckoutCompletedStoreReadsTheTopUpOfASessionAcrossEventIDsInTheEndpointScope(t *testing.T) {
	newCheckoutDB(t, "topup-only.sql")
	// A post-cutover grant: event evt_a for cs_1 is on the ledger.
	seedCheckoutEvent(t, "evt_a", "cs_1", "", "processed", "{}")
	execAll(t,
		"INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, created_at) "+
			"VALUES ('tx_a', 'u_topup', 'GRANT_TOPUP', 500, 800, 'evt_a', 1790000000000)",
		// The same session id in another account is no record for this endpoint.
		"INSERT INTO stripe_webhook_events (stripe_account_id, livemode, event_id, type, created, first_delivery_id, first_received_at, "+
			"checkout_session_id, status, updated_at) VALUES ('acct_other', 0, 'evt_o', 'checkout.session.completed', 1, 'd', 1, 'cs_other', 'processed', 1)",
		"INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, created_at) "+
			"VALUES ('tx_o', 'u_topup', 'GRANT_TOPUP', 500, 1300, 'evt_o', 1790000000001)",
	)
	store := CheckoutCompleted{Endpoint: sandboxEndpoint}

	for session, want := range map[string]bool{"cs_1": true, "cs_other": false, "cs_unknown": false} {
		got, err := store.TopUpRecorded(context.Background(), session)
		if err != nil || got != want {
			t.Errorf("TopUpRecorded(%s) = %t, %v; want %t", session, got, err, want)
		}
	}
}

func TestCheckoutCompletedStoreIgnoresAPreCutoverGrantWithNoEventAssociation(t *testing.T) {
	// topup-only.sql's GRANT_TOPUP (evt_topup_paid) has no stripe_webhook_events row.
	newCheckoutDB(t, "topup-only.sql")
	got, err := CheckoutCompleted{Endpoint: sandboxEndpoint}.TopUpRecorded(context.Background(), "cs_legacy")
	if err != nil || got {
		t.Fatalf("TopUpRecorded(cs_legacy) = %t, %v; want false", got, err)
	}

	// A replay under a different Event ID follows the ordinary path and the
	// original ledger row stays.
	if err := applyCheckout(t, "evt_replay", topUpEffects(0, "cs_legacy")); err != nil {
		t.Fatalf("apply the replay: %v", err)
	}
	if got := readBalances(t, "u_topup"); got.TopupBalance != 800 {
		t.Errorf("top-up balance = %d, want 800", got.TopupBalance)
	}
	if n := topUpGrants(t, "u_topup"); n != 2 {
		t.Errorf("GRANT_TOPUP rows = %d, want the legacy row and the replay", n)
	}
}

func TestCheckoutCompletedStoreReadsThePayersCustomerSubscriptionAndOwner(t *testing.T) {
	newCheckoutDB(t, "subscribed.sql")
	seedCheckoutEvent(t, "evt_co", "cs_sub", "sub_subscribed", "processed", checkoutPayload("cs_sub", "u_subscribed", "sub_subscribed"))
	seedCheckoutEvent(t, "evt_pending", "cs_p", "sub_pending", "pending", checkoutPayload("cs_p", "u_other", "sub_pending"))
	store := CheckoutCompleted{Endpoint: sandboxEndpoint}
	ctx := context.Background()

	if owner, err := store.CustomerOwner(ctx, "cus_subscribed"); err != nil || owner != "u_subscribed" {
		t.Errorf("CustomerOwner(cus_subscribed) = %q, %v; want u_subscribed", owner, err)
	}
	if owner, err := store.CustomerOwner(ctx, "cus_none"); err != nil || owner != "" {
		t.Errorf("CustomerOwner(cus_none) = %q, %v; want none", owner, err)
	}

	sub, err := store.Subscription(ctx, "sub_subscribed")
	want := checkoutcompleted.Subscription{Known: true, OwnerUserID: "u_subscribed", CheckoutUserID: "u_subscribed", Version: 1}
	if err != nil || sub != want {
		t.Errorf("Subscription(sub_subscribed) = %+v, %v; want %+v", sub, err, want)
	}
	// A Checkout whose event has not been processed is no stored association.
	if sub, err := store.Subscription(ctx, "sub_pending"); err != nil || sub != (checkoutcompleted.Subscription{}) {
		t.Errorf("Subscription(sub_pending) = %+v, %v; want unknown, no association", sub, err)
	}

	execAll(t, "UPDATE users SET billing_version = 4 WHERE id = 'u_subscribed'")
	o, err := store.Owner(ctx, "u_subscribed")
	if err != nil || o != (checkoutcompleted.Owner{Revision: 4, Deletion: acceptance.NoDeletion}) {
		t.Errorf("Owner(u_subscribed) = %+v, %v; want revision 4, no deletion", o, err)
	}
	if o, err := store.Owner(ctx, "u_gone"); err != nil || o.Deletion != acceptance.DeletionCompleted {
		t.Errorf("Owner(u_gone) = %+v, %v; want the deletion completed", o, err)
	}

	payload, err := store.Payload(ctx, eventScope("evt_co"))
	if err != nil || string(payload) != checkoutPayload("cs_sub", "u_subscribed", "sub_subscribed") {
		t.Errorf("Payload = %s, %v", payload, err)
	}
}

func TestApplyCheckoutCompletedGrantsATopUpOnceAndHandsTheFirstPaymentOver(t *testing.T) {
	newCheckoutDB(t, "topup-only.sql")
	execAll(t, "INSERT INTO users (id, clerk_user_id, name, email, status) VALUES ('u_ref', 'c_ref', 'Ref', 'r@example.com', 'active')")
	if _, err := (Referrals{}).Insert(context.Background(), referral.Referral{
		InviteeID: "u_topup", ReferrerID: "u_ref", Code: "AAAAAAAA", ClaimedAt: receiptT0, Status: referral.StatusClaimed,
	}); err != nil {
		t.Fatal(err)
	}

	if err := applyCheckout(t, "evt_a", topUpEffects(0, "cs_1")); err != nil {
		t.Fatalf("apply: %v", err)
	}

	if got := readBalances(t, "u_topup"); got.TopupBalance != 800 {
		t.Errorf("top-up balance = %d, want 800", got.TopupBalance)
	}
	var row struct {
		Amount, BalanceAfter int64
		PaymentIntent        string
	}
	if err := sqlitex.DB.Raw("SELECT amount, balance_after, stripe_payment_intent_id AS payment_intent FROM credit_transactions " +
		"WHERE stripe_event_id = 'evt_a' AND type = 'GRANT_TOPUP'").Scan(&row).Error; err != nil || row.Amount != 500 || row.BalanceAfter != 800 || row.PaymentIntent != "pi_cs_1" {
		t.Errorf("ledger row = %+v, %v; want 500 / 800 / pi_cs_1", row, err)
	}
	if v := billingVersion(t, "u_topup"); v != 1 {
		t.Errorf("billing_version = %d, want it advanced to 1", v)
	}
	r, ok, err := Referrals{}.Get(context.Background(), "u_topup")
	if err != nil || !ok || r.FirstPayment == nil || r.FirstPayment.PaymentIntentID != "pi_cs_1" || r.Status != referral.StatusPending {
		t.Errorf("referral = %+v, %t, %v; want the first payment recorded with a pending reward", r, ok, err)
	}
}

func TestApplyCheckoutCompletedTwoEventsOfOneSessionDecidedBeforeEitherCommitsGrantOnce(t *testing.T) {
	newCheckoutDB(t, "topup-only.sql")
	seedCheckoutEvent(t, "evt_a", "cs_1", "", "processing", "{}")
	seedCheckoutEvent(t, "evt_b", "cs_1", "", "processing", "{}")
	// Both were decided at revision 0, before either committed.
	if err := applyCheckout(t, "evt_a", topUpEffects(0, "cs_1")); err != nil {
		t.Fatalf("first apply: %v", err)
	}

	err := applyCheckout(t, "evt_b", topUpEffects(0, "cs_1"))

	if !errors.Is(err, checkoutcompleted.ErrStale) {
		t.Fatalf("stale apply = %v, want ErrStale", err)
	}
	if n := topUpGrants(t, "u_topup") - 1; n != 1 { // minus the legacy row
		t.Errorf("post-cutover GRANT_TOPUP rows = %d, want 1", n)
	}
	if got := readBalances(t, "u_topup"); got.TopupBalance != 800 {
		t.Errorf("top-up balance = %d, want one increment to 800", got.TopupBalance)
	}
	// The retry reads the grant (TopUpRecorded) and decides no effect.
	if rec, err := (CheckoutCompleted{Endpoint: sandboxEndpoint}).TopUpRecorded(context.Background(), "cs_1"); err != nil || !rec {
		t.Errorf("TopUpRecorded after the grant = %t, %v; want true", rec, err)
	}
}

func TestApplyCheckoutCompletedRechecksTheSessionWhenAGrantCommittedBetweenTheLookupAndTheOwnerRead(t *testing.T) {
	newCheckoutDB(t, "topup-only.sql")
	seedCheckoutEvent(t, "evt_a", "cs_1", "", "processing", "{}")
	seedCheckoutEvent(t, "evt_b", "cs_1", "", "processing", "{}")
	if err := applyCheckout(t, "evt_a", topUpEffects(0, "cs_1")); err != nil {
		t.Fatalf("first apply: %v", err)
	}

	// evt_b looked the session up before evt_a committed, but read the Owner
	// after: its revision is the new one, so the fence alone would pass.
	err := applyCheckout(t, "evt_b", topUpEffects(billingVersion(t, "u_topup"), "cs_1"))

	if !errors.Is(err, checkoutcompleted.ErrStale) {
		t.Fatalf("apply = %v, want ErrStale", err)
	}
	if got := readBalances(t, "u_topup"); got.TopupBalance != 800 {
		t.Errorf("top-up balance = %d, want 800", got.TopupBalance)
	}
}

func TestApplyCheckoutCompletedCommitsNothingWhenWhatItReadMovedOn(t *testing.T) {
	cases := []struct {
		name  string
		setup string
		e     checkoutcompleted.Effects
	}{
		{"the payer's billing revision moved", "UPDATE users SET billing_version = 3 WHERE id = 'u_topup'", topUpEffects(0, "cs_1")},
		{"the Customer got an owner since", "INSERT INTO stripe_customers (stripe_customer_id, user_id, created_at) VALUES ('cus_new', 'u_other', 1)",
			checkoutcompleted.Effects{
				Observed: checkoutcompleted.Observed{UserID: "u_topup", CustomerID: "cus_new"},
				Customer: &checkoutcompleted.CustomerOwnership{UserID: "u_topup", CustomerID: "cus_new"},
			}},
		{"the subscription row appeared since", "INSERT INTO subscriptions (stripe_subscription_id, stripe_customer_id, status, created_at, updated_at) VALUES ('sub_n', 'cus_n', 'active', 1, 1)",
			checkoutcompleted.Effects{
				Observed:    checkoutcompleted.Observed{UserID: "u_topup", SubscriptionID: "sub_n"},
				Association: &checkoutcompleted.CheckoutAssociation{CheckoutSessionID: "cs_n", SubscriptionID: "sub_n", UserID: "u_topup", CustomerID: "cus_n"},
			}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			newCheckoutDB(t, "topup-only.sql")
			execAll(t, tc.setup)
			e := tc.e
			e.TopUp = &checkoutcompleted.TopUp{CheckoutSessionID: "cs_1", UserID: "u_topup", Credits: 500}

			if err := applyCheckout(t, "evt_a", e); !errors.Is(err, checkoutcompleted.ErrStale) {
				t.Fatalf("apply = %v, want ErrStale", err)
			}
			if got := readBalances(t, "u_topup"); got.TopupBalance != 300 {
				t.Errorf("top-up balance = %d, want it untouched at 300", got.TopupBalance)
			}
		})
	}
}

func TestApplyCheckoutCompletedRecordsTheCustomerWithoutOverwritingAnOwner(t *testing.T) {
	newCheckoutDB(t, "topup-only.sql")
	e := checkoutcompleted.Effects{
		Observed: checkoutcompleted.Observed{UserID: "u_topup", CustomerID: "cus_second"},
		Customer: &checkoutcompleted.CustomerOwnership{UserID: "u_topup", CustomerID: "cus_second"},
	}

	if err := applyCheckout(t, "evt_a", e); err != nil {
		t.Fatalf("apply: %v", err)
	}

	var owner string
	if err := sqlitex.DB.Raw("SELECT user_id FROM stripe_customers WHERE stripe_customer_id = 'cus_second'").Scan(&owner).Error; err != nil || owner != "u_topup" {
		t.Errorf("owner of cus_second = %q, %v; want u_topup", owner, err)
	}
	if v := billingVersion(t, "u_topup"); v != 1 {
		t.Errorf("billing_version = %d, want 1: a Customer change is acceptance-relevant", v)
	}
	// The existing Customer is still u_topup's: nothing was moved.
	if owner, _ := (CheckoutCompleted{}).CustomerOwner(context.Background(), "cus_topup"); owner != "u_topup" {
		t.Errorf("owner of cus_topup = %q, want u_topup", owner)
	}
}

func TestApplyCheckoutCompletedCreatesAnUnattributedSubscriptionAndWakesItsWaitingEvents(t *testing.T) {
	newCheckoutDB(t, "topup-only.sql")
	seedCheckoutEvent(t, "evt_inv", "", "sub_new", "waiting_dependency", "{}")
	future := receiptT0.Add(time.Hour).UnixMilli()
	execAll(t,
		"UPDATE stripe_webhook_events SET next_attempt_at = "+strconv.FormatInt(future, 10)+" WHERE event_id = 'evt_inv'",
		"INSERT INTO stripe_webhook_events (stripe_account_id, livemode, event_id, type, created, first_delivery_id, first_received_at, "+
			"subscription_id, status, next_attempt_at, updated_at) VALUES ('acct_sandbox', 0, 'evt_other', 'invoice.paid', 1, 'd', 1, 'sub_else', 'waiting_dependency', "+strconv.FormatInt(future, 10)+", 1)",
	)
	e := checkoutcompleted.Effects{
		Observed:    checkoutcompleted.Observed{UserID: "u_topup", SubscriptionID: "sub_new"},
		Association: &checkoutcompleted.CheckoutAssociation{CheckoutSessionID: "cs_n", SubscriptionID: "sub_new", UserID: "u_topup", CustomerID: "cus_n"},
	}

	if err := applyCheckout(t, "evt_a", e); err != nil {
		t.Fatalf("apply: %v", err)
	}

	got, ok := readSnapshot(t, "sub_new")
	if !ok || !got.Unowned || got.StripeCustomerID != "cus_n" || got.Classification != "" {
		t.Errorf("row = %+v, %t; want an unowned, unclassified row for cus_n", got, ok)
	}
	next := map[string]int64{}
	var rows []struct {
		EventID       string
		NextAttemptAt int64
	}
	if err := sqlitex.DB.Raw("SELECT event_id, next_attempt_at FROM stripe_webhook_events WHERE status = 'waiting_dependency'").Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		next[r.EventID] = r.NextAttemptAt
	}
	if next["evt_inv"] != receiptT0.UnixMilli() || next["evt_other"] != future {
		t.Errorf("next attempts = %v; want only sub_new's waiting event due now (%d)", next, receiptT0.UnixMilli())
	}
}

func TestWebhookEventsSaveRollsTheTaskBackWhenACheckoutEffectFails(t *testing.T) {
	newCheckoutDB(t, "topup-only.sql")
	// The zero WebhookEffects has no referral policy, so the first-payment
	// handoff fails after the grant was written.
	store := NewWebhookEvents(ApplyWebhookEffects)
	read := claimedTask(t, store)
	next := read
	next.Status = webhookevent.Processed

	err := store.Save(context.Background(), sandboxScope, read, next, topUpEffects(0, "cs_1"))

	if err == nil {
		t.Fatal("Save = nil, want the failed handoff")
	}
	if got := readBalances(t, "u_topup"); got.TopupBalance != 300 {
		t.Errorf("top-up balance = %d, want the grant rolled back to 300", got.TopupBalance)
	}
	if st := unfinished(t, store)["evt_1"].Task.Status; st == webhookevent.Processed {
		t.Errorf("task status = %s, want it not completed", st)
	}
}
