package sqlitex

import (
	"reflect"
	"testing"

	"gorm.io/gorm"
)

// poolGrants maps each credit_accounts user to the grant its pool points at,
// "" for none.
func poolGrants(t *testing.T, db *gorm.DB) map[string]string {
	t.Helper()
	var rows []struct {
		UserID      string
		PoolGrantID *string
	}
	if err := db.Raw("SELECT user_id, pool_grant_id FROM credit_accounts").Scan(&rows).Error; err != nil {
		t.Fatalf("read pool grants: %v", err)
	}
	out := map[string]string{}
	for _, r := range rows {
		out[r.UserID] = ""
		if r.PoolGrantID != nil {
			out[r.UserID] = *r.PoolGrantID
		}
	}
	return out
}

// ledgerAndBalances is every legacy credit_transactions and credit_accounts
// value, which the migration must not change.
func ledgerAndBalances(t *testing.T, db *gorm.DB) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, q := range []string{
		"SELECT id, user_id, type, amount, balance_after, stripe_event_id, stripe_payment_intent_id, related_transaction_id, note, created_at FROM credit_transactions ORDER BY id",
		"SELECT user_id, subscription_balance, topup_balance, period_end, updated_at FROM credit_accounts ORDER BY user_id",
	} {
		var rows []map[string]any
		if err := db.Raw(q).Scan(&rows).Error; err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		if len(rows) == 0 {
			t.Fatalf("%s: no rows, want the fixtures' rows", q)
		}
		out = append(out, rows...)
	}
	return out
}

func TestCreditProvenanceMigrationPointsEachPoolAtTheGrantThatSuppliesIt(t *testing.T) {
	db := legacyBillingDB(t, "subscribed.sql", "overwritten-subscription.sql", "topup-only.sql", "deleted-user.sql")
	before := ledgerAndBalances(t, db)

	applied, err := MigrateCreditProvenance(db)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if !applied {
		t.Fatal("applied = false, want the first run to apply the migration")
	}
	// The legacy pool comes from the user's latest GRANT_SUBSCRIPTION, the
	// rule today's refund clawback uses; a top-up-only pool has none.
	want := map[string]string{
		"u_subscribed":  "tx_subscribed_grant",
		"u_overwritten": "tx_overwritten_second",
		"u_topup":       "",
	}
	if got := poolGrants(t, db); !reflect.DeepEqual(got, want) {
		t.Errorf("pool grants = %v, want %v", got, want)
	}
	if after := ledgerAndBalances(t, db); !reflect.DeepEqual(after, before) {
		t.Errorf("ledger and balances changed:\nbefore %v\nafter  %v", before, after)
	}
}

func TestCreditProvenanceMigrationBreaksASameMillisecondTieByInsertOrder(t *testing.T) {
	db := legacyBillingDB(t, "subscribed.sql")
	execAll(t, db, "INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, created_at) "+
		"VALUES ('tx_a_same_ms', 'u_subscribed', 'GRANT_SUBSCRIPTION', 500, 500, 'evt_same_ms', 1788000000000)")

	if _, err := MigrateCreditProvenance(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if got := poolGrants(t, db)["u_subscribed"]; got != "tx_a_same_ms" {
		t.Errorf("pool grant = %q, want the later-inserted tx_a_same_ms", got)
	}
}

func TestCreditProvenanceMigrationRunsOnlyOnce(t *testing.T) {
	db := legacyBillingDB(t, "subscribed.sql")
	if _, err := MigrateCreditProvenance(db); err != nil {
		t.Fatalf("first run: %v", err)
	}

	applied, err := MigrateCreditProvenance(db)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if applied {
		t.Fatal("applied = true on the second run, want it to see the marker and do nothing")
	}
}

func TestAFailedCreditProvenanceMigrationLeavesNothingBehind(t *testing.T) {
	db := legacyBillingDB(t, "subscribed.sql")
	// A stray column of the same name makes the last ALTER fail.
	execAll(t, db, "ALTER TABLE credit_accounts ADD COLUMN pool_grant_id text")
	before, err := tableColumns(db, "credit_transactions")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := MigrateCreditProvenance(db); err == nil {
		t.Fatal("migrate succeeded over a stray pool_grant_id column, want an error")
	}
	after, err := tableColumns(db, "credit_transactions")
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Errorf("credit_transactions has %d columns after the failure, want the legacy %d", len(after), len(before))
	}
	if done, err := migrationApplied(db, CreditProvenanceVersion); err != nil || done {
		t.Errorf("marker after the failure = %v, %v; want none", done, err)
	}
}

func TestCreditProvenanceMigrationAllowsOneSubscriptionGrantPerInvoice(t *testing.T) {
	db := legacyBillingDB(t, "subscribed.sql")
	if _, err := MigrateCreditProvenance(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	insert := "INSERT INTO credit_transactions (id, user_id, type, amount, balance_after, stripe_event_id, stripe_invoice_id, created_at) " +
		"VALUES (?, 'u_subscribed', ?, 100, 100, ?, 'in_1', 1789000000000)"
	if err := db.Exec(insert, "tx_first", "GRANT_SUBSCRIPTION", "evt_first").Error; err != nil {
		t.Fatalf("first grant of in_1: %v", err)
	}
	if err := db.Exec(insert, "tx_again", "GRANT_SUBSCRIPTION", "evt_again").Error; err == nil {
		t.Error("a second subscription grant of in_1 under another Event ID was stored, want a uniqueness error")
	}
	if err := db.Exec(insert, "tx_clawback", "CLAWBACK", "evt_refund").Error; err != nil {
		t.Errorf("a clawback naming in_1: %v, want it stored", err)
	}
}
