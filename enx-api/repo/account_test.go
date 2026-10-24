package repo

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"enx-api/account"
	"enx-api/utils/sqlitex"
)

// newAccountDB opens a fresh database with the full schema, as deletion
// touches nearly every table.
func newAccountDB(t *testing.T) {
	t.Helper()
	prev := sqlitex.DB
	if err := sqlitex.InitWithLogLevel(filepath.Join(t.TempDir(), "account.db"), "warn"); err != nil {
		t.Fatal(err)
	}
	if sqlitex.DB == nil || sqlitex.DB == prev {
		t.Fatal("sqlitex.DB was not opened")
	}
	t.Cleanup(func() { sqlitex.DB = prev })
}

func seedAccount(t *testing.T, id, email string) {
	t.Helper()
	if err := sqlitex.DB.Create(&sqlitex.User{
		Id: id, ClerkUserID: "user_" + id, Name: id, Email: email, Status: "active", CreatedAt: time.Now(),
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func countRows(t *testing.T, table, column, id string) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Table(table).Where(column+" = ?", id).Count(&n).Error; err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func TestAccountsDeleteDataRemovesPersonalRowsAndKeepsTheLedger(t *testing.T) {
	newAccountDB(t)
	ctx := context.Background()
	seedAccount(t, "alice", "alice@example.com")
	seedAccount(t, "bob", "bob@example.com")
	for _, id := range []string{"alice", "bob"} {
		for _, row := range []any{
			&sqlitex.UserDict{UserId: id, WordId: "w1", CreatedAt: 1, UpdatedAt: 1},
			&sqlitex.LookupEvent{UserID: id, At: 1, Outcome: "hit"},
			&sqlitex.SavedPage{ID: id + "-p", UserID: id, URL: "https://x", Host: "x", CreatedAt: 1},
			&sqlitex.UserPreference{UserId: id, Key: "k", Value: "true", UpdatedAt: 1},
			&sqlitex.ReferralCode{UserId: id, Code: id + "-code", CreatedAt: 1},
			&sqlitex.CreditAccount{UserId: id, UpdatedAt: 1},
			&sqlitex.CreditTransaction{Id: id + "-tx", UserId: id, Type: "GRANT_TOPUP", Amount: 5, BalanceAfter: 5, CreatedAt: 1},
			&sqlitex.Subscription{UserId: id, StripeCustomerId: id + "-cus", Status: "canceled", CreatedAt: 1, UpdatedAt: 1},
		} {
			if err := sqlitex.DB.Create(row).Error; err != nil {
				t.Fatalf("seed %T: %v", row, err)
			}
		}
	}

	if err := (Accounts{}).DeleteData(ctx, "alice"); err != nil {
		t.Fatalf("DeleteData: %v", err)
	}

	for _, tc := range personalTables {
		if n := countRows(t, tc.table, tc.column, "alice"); n != 0 {
			t.Errorf("%s: %d row(s) of alice left", tc.table, n)
		}
	}
	for _, table := range []string{"credit_transactions", "subscriptions"} {
		if n := countRows(t, table, "user_id", "alice"); n != 1 {
			t.Errorf("%s: %d row(s) of alice, want the ledger row kept", table, n)
		}
	}
	if n := countRows(t, "users", "id", "bob"); n != 1 {
		t.Fatal("another user's rows must be untouched")
	}
	if n := countRows(t, "user_dicts", "user_id", "bob"); n != 1 {
		t.Fatal("another user's word list must be untouched")
	}
}

func TestAccountsDeleteDataKeepsTheDeletionGate(t *testing.T) {
	newAccountDB(t)
	if _, err := sqlitex.MigrateDeletionGates(sqlitex.DB); err != nil {
		t.Fatal(err)
	}
	seedAccount(t, "alice", "alice@example.com")
	if err := sqlitex.DB.Exec("INSERT INTO account_deletion_gates (user_id, state, started_at, updated_at) VALUES ('alice', 'in_progress', 1, 1)").Error; err != nil {
		t.Fatal(err)
	}

	if err := (Accounts{}).DeleteData(context.Background(), "alice"); err != nil {
		t.Fatalf("DeleteData: %v", err)
	}

	if n := countRows(t, "account_deletion_gates", "user_id", "alice"); n != 1 {
		t.Errorf("account_deletion_gates: %d row(s) of alice, want the gate kept after the hard deletion", n)
	}
}

func TestAccountsGetAndSetStatus(t *testing.T) {
	newAccountDB(t)
	ctx := context.Background()
	seedAccount(t, "alice", "alice@example.com")

	if err := (Accounts{}).SetStatus(ctx, "alice", account.StatusDisabled); err != nil {
		t.Fatal(err)
	}
	u, ok, err := Accounts{}.Get(ctx, "alice")
	if err != nil || !ok || u.Status != account.StatusDisabled || u.ClerkUserID != "user_alice" || u.Email != "alice@example.com" {
		t.Fatalf("Get = %+v, %v, %v", u, ok, err)
	}
	if _, ok, err := (Accounts{}).Get(ctx, "nobody"); ok || err != nil {
		t.Fatalf("Get(nobody) = %v, %v; want not found", ok, err)
	}
}

var testHash = account.NewEmailHMAC("repo-test").Of

func TestTrialUsedByAnotherAccount(t *testing.T) {
	newAccountDB(t)
	ctx := context.Background()
	g := TrialGrants{Hash: testHash}
	seedAccount(t, "fresh", "fresh@example.com")
	seedAccount(t, "owner", "owner@example.com")
	seedAccount(t, "again", "Again@example.com")
	seedAccount(t, "noemail", "")
	_ = g.Record(ctx, testHash("owner@example.com"), "owner", time.Now())
	_ = g.Record(ctx, testHash(" again@EXAMPLE.com"), "deleted-account", time.Now())

	for id, want := range map[string]bool{"fresh": false, "owner": false, "again": true, "noemail": true} {
		got, err := g.TrialUsedByAnotherAccount(ctx, id)
		if err != nil || got != want {
			t.Errorf("%s: TrialUsedByAnotherAccount = %v, %v; want %v", id, got, err, want)
		}
	}
}

func TestTrialGrantsBackfillRecordsEveryEmailOnceAndKeepsExistingRecords(t *testing.T) {
	newAccountDB(t)
	ctx := context.Background()
	g := TrialGrants{Hash: testHash}
	seedAccount(t, "alice", "alice@example.com")
	seedAccount(t, "bob", "bob@example.com")
	seedAccount(t, "noemail", "")
	_ = g.Record(ctx, testHash("bob@example.com"), "bob-before", time.Now())

	added, err := g.Backfill(ctx, time.Now())
	if err != nil || added != 1 {
		t.Fatalf("Backfill = %d, %v; want 1 added", added, err)
	}
	if again, err := g.Backfill(ctx, time.Now()); err != nil || again != 0 {
		t.Fatalf("second Backfill = %d, %v; want 0", again, err)
	}
	var rows []sqlitex.TrialGrant
	sqlitex.DB.Order("user_id").Find(&rows)
	if len(rows) != 2 || rows[0].UserId != "alice" || rows[1].UserId != "bob-before" {
		t.Fatalf("records = %+v, want alice's added and bob's kept", rows)
	}
}

func TestTrialGrantsDelete(t *testing.T) {
	newAccountDB(t)
	ctx := context.Background()
	g := TrialGrants{Hash: testHash}
	h := testHash("alice@example.com")
	_ = g.Record(ctx, h, "alice", time.Now())
	if err := g.Delete(ctx, h); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, "trial_grants", "email_hmac", h); n != 0 {
		t.Fatalf("%d record(s) left", n)
	}
}
