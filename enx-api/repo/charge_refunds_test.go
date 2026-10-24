package repo

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"enx-api/billing/acceptance"
	"enx-api/billing/chargerefunded"
	"enx-api/billing/creditperiod"
	"enx-api/billing/invoice"
	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

func execAll(t *testing.T, stmts ...string) {
	t.Helper()
	for _, s := range stmts {
		if err := sqlitex.DB.Exec(s).Error; err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
}

// recordSubscriptionProvenance gives the subscribed fixture's grant the
// provenance of sub_subscribed's period ending where its pool does.
func recordSubscriptionProvenance(t *testing.T) {
	t.Helper()
	execAll(t, "UPDATE credit_transactions SET grant_kind = 'normal_period', stripe_invoice_id = 'in_subscribed', "+
		"stripe_subscription_id = 'sub_subscribed', period_start = 1797000000, period_end = 1800000000, purchased = 500, applied = 500 "+
		"WHERE id = 'tx_subscribed_grant'")
}

var subscribedMay = creditperiod.Source{SubscriptionID: "sub_subscribed", Period: invoice.Period{Start: 1797000000, End: 1800000000}}

func grantForPaymentIntent(t *testing.T, paymentIntentID string) (chargerefunded.Grant, bool) {
	t.Helper()
	g, found, err := ChargeRefunds{}.GrantForPaymentIntent(context.Background(), paymentIntentID)
	if err != nil {
		t.Fatalf("GrantForPaymentIntent(%s): %v", paymentIntentID, err)
	}
	return g, found
}

func TestChargeRefundsReadsATopUpGrantWithWhatEarlierClawbacksTook(t *testing.T) {
	// deleted-user.sql adds a clawback of another grant.
	newSubscriptionConflictDB(t, "topup-only.sql", "deleted-user.sql")
	execAll(t,
		"INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, related_transaction_id, created_at) "+
			"VALUES ('tx_c1', 'u_topup', 'CLAWBACK', -90, 210, 'evt_r1', 'tx_topup_grant', 1789000000000)",
		"INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, related_transaction_id, created_at) "+
			"VALUES ('tx_c2', 'u_topup', 'CLAWBACK', -30, 180, 'evt_r2', 'tx_topup_grant', 1789000001000)",
	)

	g, found := grantForPaymentIntent(t, "pi_topup")

	want := chargerefunded.Grant{ID: "tx_topup_grant", UserID: "u_topup", Pool: chargerefunded.PoolTopUp, Credits: 300, Taken: 120}
	if !found || !reflect.DeepEqual(g, want) {
		t.Errorf("grant = %+v, found %t; want %+v", g, found, want)
	}
}

func TestChargeRefundsReadsASubscriptionGrantsProvenance(t *testing.T) {
	t.Run("a grant with its period and what it applied", func(t *testing.T) {
		newSubscriptionConflictDB(t, "subscribed.sql")
		recordSubscriptionProvenance(t)
		execAll(t, "UPDATE credit_transactions SET applied = 0 WHERE id = 'tx_subscribed_grant'")

		g, found := grantForPaymentIntent(t, "pi_subscribed")

		want := chargerefunded.Grant{
			ID: "tx_subscribed_grant", UserID: "u_subscribed", Pool: chargerefunded.PoolSubscription,
			Period: creditperiod.Grant{Source: subscribedMay, Applied: 0},
		}
		if !found || !reflect.DeepEqual(g, want) {
			t.Errorf("grant = %+v, found %t; want %+v", g, found, want)
		}
	})
	t.Run("a migrated grant Stripe could not pin to one invoice", func(t *testing.T) {
		newSubscriptionConflictDB(t, "subscribed.sql")
		execAll(t, "UPDATE credit_transactions SET grant_kind = 'normal_period', stripe_subscription_id = 'sub_subscribed', "+
			"period_end = 1800000000, without_period = 1, provenance_reason = 'no_single_invoice' WHERE id = 'tx_subscribed_grant'")

		g, _ := grantForPaymentIntent(t, "pi_subscribed")

		want := creditperiod.Grant{
			Source:        creditperiod.Source{SubscriptionID: "sub_subscribed", Period: invoice.Period{End: 1800000000}},
			WithoutPeriod: true, Applied: 500,
		}
		if !reflect.DeepEqual(g.Period, want) {
			t.Errorf("grant period = %+v, want %+v", g.Period, want)
		}
	})
	t.Run("an old ledger grant the backfill did not cover", func(t *testing.T) {
		newSubscriptionConflictDB(t, "deleted-user.sql")

		g, found := grantForPaymentIntent(t, "pi_deleted")

		want := chargerefunded.Grant{
			ID: "tx_deleted_grant", UserID: "u_deleted", Pool: chargerefunded.PoolSubscription,
			Period: creditperiod.Grant{Applied: 100}, Taken: 100,
		}
		if !found || !reflect.DeepEqual(g, want) {
			t.Errorf("grant = %+v, found %t; want %+v", g, found, want)
		}
	})
}

func TestChargeRefundsFindsNoGrantForAnUnrecordedPaymentIntent(t *testing.T) {
	newSubscriptionConflictDB(t, "subscribed.sql", "topup-only.sql")

	if g, found := grantForPaymentIntent(t, "pi_unknown"); found {
		t.Errorf("grant = %+v, want none", g)
	}
}

func TestChargeRefundsRefusesToGuessBetweenTwoGrantsOfOnePaymentIntent(t *testing.T) {
	newSubscriptionConflictDB(t, "subscribed.sql")
	execAll(t, "INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, stripe_payment_intent_id, created_at) "+
		"VALUES ('tx_again', 'u_subscribed', 'GRANT_SUBSCRIPTION', 500, 500, 'evt_subscribed_paid_again', 'pi_subscribed', 1788000001000)")

	_, _, err := ChargeRefunds{}.GrantForPaymentIntent(context.Background(), "pi_subscribed")

	if err == nil {
		t.Error("GrantForPaymentIntent of a PaymentIntent two grants record = nil error, want one")
	}
}

func TestChargeRefundsClawbackRecordedReadsTheEventsClawback(t *testing.T) {
	newSubscriptionConflictDB(t, "deleted-user.sql")
	ctx := context.Background()

	for id, want := range map[string]bool{"evt_deleted_refund": true, "evt_deleted_paid": false, "evt_other": false} {
		got, err := ChargeRefunds{}.ClawbackRecorded(ctx, eventScope(id))
		if err != nil || got != want {
			t.Errorf("ClawbackRecorded(%s) = %t, %v; want %t", id, got, err, want)
		}
	}
}

func TestChargeRefundsPayloadIsTheFirstDeliverysOriginalPayload(t *testing.T) {
	newSubscriptionConflictDB(t)
	receiveEvent(t, "dlv_1", sandboxScope, receiptT0)
	receiveEvent(t, "dlv_2", sandboxScope, receiptT0.Add(time.Minute))
	ctx := context.Background()

	got, err := ChargeRefunds{}.Payload(ctx, sandboxScope)
	if err != nil {
		t.Fatalf("Payload: %v", err)
	}
	if want := paidInvoiceDelivery("dlv_1", sandboxScope, receiptT0).Payload; string(got) != string(want) {
		t.Errorf("Payload = %s, want %s", got, want)
	}
	if _, err := (ChargeRefunds{}).Payload(ctx, eventScope("evt_missing")); err == nil {
		t.Error("Payload of an event never received = nil error, want one")
	}
}

func refundOwner(t *testing.T, userID string) chargerefunded.Owner {
	t.Helper()
	o, err := ChargeRefunds{}.Owner(context.Background(), userID)
	if err != nil {
		t.Fatalf("Owner(%s): %v", userID, err)
	}
	return o
}

func TestChargeRefundsOwnerReadsTheRevisionBalanceAndPoolProvenance(t *testing.T) {
	newSubscriptionConflictDB(t, "subscribed.sql")
	recordSubscriptionProvenance(t)
	execAll(t, "UPDATE users SET billing_version = 6 WHERE id = 'u_subscribed'")
	if err := MarkLegacyBackfillDone(context.Background()); err != nil {
		t.Fatal(err)
	}

	got := refundOwner(t, "u_subscribed")

	want := chargerefunded.Owner{Revision: 6, Pool: creditperiod.Pool{Source: subscribedMay}, SubscriptionBalance: 500}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Owner = %+v, want %+v", got, want)
	}
}

func TestChargeRefundsOwnerReadsAMigratedPoolsProvenanceState(t *testing.T) {
	cases := []struct {
		name         string
		stmts        []string
		backfillDone bool
		want         creditperiod.Pool
	}{
		{
			name: "the backfill has not recorded the pool's grant yet",
			want: creditperiod.Pool{BackfillPending: true},
		},
		{
			name:         "the backfill finished without covering the grant",
			backfillDone: true,
			want:         creditperiod.Pool{},
		},
		{
			name: "the backfill could not pin the grant to one invoice",
			stmts: []string{"UPDATE credit_transactions SET grant_kind = 'normal_period', stripe_subscription_id = 'sub_subscribed', " +
				"period_end = 1800000000, without_period = 1, provenance_reason = 'no_single_invoice' WHERE id = 'tx_subscribed_grant'"},
			want: creditperiod.Pool{
				Source:        creditperiod.Source{SubscriptionID: "sub_subscribed", Period: invoice.Period{End: 1800000000}},
				WithoutPeriod: true,
			},
		},
		{
			name:  "no grant supplies the pool",
			stmts: []string{"UPDATE credit_accounts SET pool_grant_id = NULL WHERE user_id = 'u_subscribed'"},
			want:  creditperiod.Pool{},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			newSubscriptionConflictDB(t, "subscribed.sql")
			execAll(t, c.stmts...)
			if c.backfillDone {
				if err := MarkLegacyBackfillDone(context.Background()); err != nil {
					t.Fatal(err)
				}
			}

			if got := refundOwner(t, "u_subscribed").Pool; !reflect.DeepEqual(got, c.want) {
				t.Errorf("Pool = %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestChargeRefundsOwnerReadsTheDeletionState(t *testing.T) {
	t.Run("a deletion in progress", func(t *testing.T) {
		newSubscriptionConflictDB(t, "subscribed.sql")
		seedDeletionGate(t, "u_subscribed", "in_progress")

		if got := refundOwner(t, "u_subscribed").Deletion; got != acceptance.DeletionInProgress {
			t.Errorf("Deletion = %v, want in progress", got)
		}
	})
	t.Run("a deletion the gate records as done", func(t *testing.T) {
		newSubscriptionConflictDB(t)
		seedDeletionGate(t, "u_gone", "deleted")

		got := refundOwner(t, "u_gone")
		if want := (chargerefunded.Owner{Deletion: acceptance.DeletionCompleted}); !reflect.DeepEqual(got, want) {
			t.Errorf("Owner = %+v, want %+v", got, want)
		}
	})
	// Accounts deleted before the gate existed left a ledger but no users row.
	t.Run("a deletion from before the gate", func(t *testing.T) {
		newSubscriptionConflictDB(t, "deleted-user.sql")

		if got := refundOwner(t, "u_deleted").Deletion; got != acceptance.DeletionCompleted {
			t.Errorf("Deletion = %v, want completed", got)
		}
	})
}

type ledgerRow struct {
	UserID               string
	Type                 string
	Amount               int64
	BalanceAfter         int64
	StripeEventID        string
	RelatedTransactionID string
	Note                 string
}

func clawbackRows(t *testing.T) []ledgerRow {
	t.Helper()
	var rows []ledgerRow
	if err := sqlitex.DB.Raw("SELECT user_id, type, amount, balance_after, stripe_event_id, related_transaction_id, note " +
		"FROM credit_transactions WHERE type = 'CLAWBACK' AND user_id != 'u_deleted' ORDER BY created_at, rowid").Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

type balances struct{ SubscriptionBalance, TopupBalance int64 }

func readBalances(t *testing.T, userID string) balances {
	t.Helper()
	var b balances
	if err := sqlitex.DB.Raw("SELECT subscription_balance, topup_balance FROM credit_accounts WHERE user_id = ?", userID).Scan(&b).Error; err != nil {
		t.Fatal(err)
	}
	return b
}

func applyClawback(t *testing.T, scope webhookevent.Scope, e chargerefunded.Effects) error {
	t.Helper()
	return sqlitex.DB.Transaction(func(tx *gorm.DB) error { return ApplyClawback(tx, scope, e) })
}

func topUpClawback(credits int64) chargerefunded.Effects {
	return chargerefunded.Effects{
		Observed: chargerefunded.Observed{UserID: "u_topup", GrantID: "tx_topup_grant"},
		Clawback: &chargerefunded.Clawback{
			GrantID: "tx_topup_grant", UserID: "u_topup", Pool: chargerefunded.PoolTopUp, Credits: credits,
			ChargeID: "ch_topup", Refunded: 1000, Captured: 1000,
		},
	}
}

func TestApplyClawbackTakesATopUpsCreditsEvenBelowZeroAndRecordsTheClawback(t *testing.T) {
	newSubscriptionConflictDB(t, "topup-only.sql")
	execAll(t, "UPDATE credit_accounts SET topup_balance = 100 WHERE user_id = 'u_topup'")

	if err := applyClawback(t, eventScope("evt_refund"), topUpClawback(300)); err != nil {
		t.Fatalf("ApplyClawback: %v", err)
	}

	if got := readBalances(t, "u_topup"); got != (balances{TopupBalance: -200}) {
		t.Errorf("balances = %+v, want the top-up pool at -200", got)
	}
	want := []ledgerRow{{
		UserID: "u_topup", Type: "CLAWBACK", Amount: -300, BalanceAfter: -200, StripeEventID: "evt_refund",
		RelatedTransactionID: "tx_topup_grant", Note: "Stripe charge ch_topup, 1000 of 1000 refunded",
	}}
	if got := clawbackRows(t); !reflect.DeepEqual(got, want) {
		t.Errorf("clawbacks = %+v, want %+v", got, want)
	}
	if recorded, err := (ChargeRefunds{}).ClawbackRecorded(context.Background(), eventScope("evt_refund")); err != nil || !recorded {
		t.Errorf("ClawbackRecorded after the clawback = %t, %v; want true", recorded, err)
	}
}

func TestApplyClawbackTakesFromTheSubscriptionPool(t *testing.T) {
	newSubscriptionConflictDB(t, "subscribed.sql")
	execAll(t, "UPDATE users SET billing_version = 6 WHERE id = 'u_subscribed'")
	e := chargerefunded.Effects{
		Observed: chargerefunded.Observed{UserID: "u_subscribed", Revision: 6, GrantID: "tx_subscribed_grant", SubscriptionBalance: 500},
		Clawback: &chargerefunded.Clawback{
			GrantID: "tx_subscribed_grant", UserID: "u_subscribed", Pool: chargerefunded.PoolSubscription, Credits: 250,
			ChargeID: "ch_sub", Refunded: 1000, Captured: 2000,
		},
	}

	if err := applyClawback(t, eventScope("evt_refund"), e); err != nil {
		t.Fatalf("ApplyClawback: %v", err)
	}

	if got := readBalances(t, "u_subscribed"); got != (balances{SubscriptionBalance: 250}) {
		t.Errorf("balances = %+v, want 250 left in the subscription pool", got)
	}
	if got := clawbackRows(t); len(got) != 1 || got[0].Amount != -250 || got[0].BalanceAfter != 250 {
		t.Errorf("clawbacks = %+v, want one taking 250 and leaving 250", got)
	}
}

func TestApplyClawbackAfterDeletionRecordsTheRefundWithoutRecreatingABalance(t *testing.T) {
	newSubscriptionConflictDB(t, "deleted-user.sql")
	e := chargerefunded.Effects{
		Observed: chargerefunded.Observed{UserID: "u_deleted", GrantID: "tx_deleted_grant", Taken: 100},
		Clawback: &chargerefunded.Clawback{
			GrantID: "tx_deleted_grant", UserID: "u_deleted", Pool: chargerefunded.PoolSubscription,
			ChargeID: "ch_deleted", Refunded: 1000, Captured: 1000,
		},
	}

	if err := applyClawback(t, eventScope("evt_late_refund"), e); err != nil {
		t.Fatalf("ApplyClawback: %v", err)
	}

	if n := countRows(t, "credit_accounts", "user_id", "u_deleted"); n != 0 {
		t.Errorf("%d credit accounts for the deleted user, want none recreated", n)
	}
	if n := countRows(t, "users", "id", "u_deleted"); n != 0 {
		t.Errorf("%d users rows for the deleted user, want none recreated", n)
	}
	recorded, err := ChargeRefunds{}.ClawbackRecorded(context.Background(), eventScope("evt_late_refund"))
	if err != nil || !recorded {
		t.Errorf("ClawbackRecorded = %t, %v; want the zero-effect clawback recorded", recorded, err)
	}
}

func TestApplyClawbackRefusesToTakeCreditsFromAMissingCreditAccount(t *testing.T) {
	newSubscriptionConflictDB(t, "topup-only.sql")
	execAll(t, "DELETE FROM credit_accounts WHERE user_id = 'u_topup'")

	err := applyClawback(t, eventScope("evt_refund"), topUpClawback(100))

	if err == nil || errors.Is(err, chargerefunded.ErrStale) {
		t.Errorf("ApplyClawback = %v, want an error that is not ErrStale", err)
	}
	if n := countRows(t, "credit_accounts", "user_id", "u_topup"); n != 0 {
		t.Errorf("%d credit accounts, want none created", n)
	}
	if got := clawbackRows(t); len(got) != 0 {
		t.Errorf("clawbacks = %+v, want none", got)
	}
}

func TestApplyClawbackChangesNothingWhenWhatItReadMovedOn(t *testing.T) {
	cases := []struct {
		name   string
		stmt   string
		effect func() chargerefunded.Effects
	}{
		{
			name:   "the owner's billing revision moved on",
			stmt:   "UPDATE users SET billing_version = billing_version + 1 WHERE id = 'u_topup'",
			effect: func() chargerefunded.Effects { return topUpClawback(100) },
		},
		{
			name: "another clawback of the grant was recorded",
			stmt: "INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, related_transaction_id, created_at) " +
				"VALUES ('tx_c1', 'u_topup', 'CLAWBACK', -90, 210, 'evt_r1', 'tx_topup_grant', 1789000000000)",
			effect: func() chargerefunded.Effects { return topUpClawback(100) },
		},
		{
			name: "the subscription balance changed",
			stmt: "UPDATE credit_accounts SET subscription_balance = 40 WHERE user_id = 'u_topup'",
			effect: func() chargerefunded.Effects {
				e := topUpClawback(0)
				e.Clawback.Pool = chargerefunded.PoolSubscription
				return e
			},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			newSubscriptionConflictDB(t, "topup-only.sql")
			execAll(t, c.stmt)
			before := readBalances(t, "u_topup")
			rowsBefore := clawbackRows(t)

			err := applyClawback(t, eventScope("evt_refund"), c.effect())

			if !errors.Is(err, chargerefunded.ErrStale) {
				t.Errorf("ApplyClawback = %v, want chargerefunded.ErrStale", err)
			}
			if got := readBalances(t, "u_topup"); got != before {
				t.Errorf("balances = %+v, want unchanged %+v", got, before)
			}
			if got := clawbackRows(t); !reflect.DeepEqual(got, rowsBefore) {
				t.Errorf("clawbacks = %+v, want unchanged %+v", got, rowsBefore)
			}
		})
	}
}

func TestWebhookEventsSaveCommitsAClawbackWithItsTask(t *testing.T) {
	newSubscriptionConflictDB(t, "topup-only.sql")
	store := NewWebhookEvents(ApplyWebhookEffects)
	claimed := claimedTask(t, store)
	done, _ := webhookevent.Complete(claimed, "tok_a", receiptT0.Add(2*time.Minute))

	if err := store.Save(context.Background(), sandboxScope, claimed, done, topUpClawback(300)); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if got := unfinished(t, store); len(got) != 0 {
		t.Errorf("unfinished tasks = %v, want the event processed", got)
	}
	if got := clawbackRows(t); len(got) != 1 || got[0].StripeEventID != sandboxScope.EventID || got[0].Amount != -300 {
		t.Errorf("clawbacks = %+v, want one for %s taking 300", got, sandboxScope.EventID)
	}
}
