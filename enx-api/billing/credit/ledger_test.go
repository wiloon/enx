package credit

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"enx-api/utils/sqlitex"
)

func TestMain(m *testing.M) {
	dbPath := filepath.Join(os.TempDir(), "enx-credit-ledger-test.db")
	_ = os.Remove(dbPath)
	sqlitex.Init(dbPath)
	os.Exit(m.Run())
}

// seedPaidPools sets userID's subscription and top-up pools directly, with
// a subscription period a month out. Paid grants are written by the webhook
// handlers in repo, which this package cannot import; the tests here only
// need the pools, not the grant's ledger row.
func seedPaidPools(t *testing.T, userID string, subscription, topup int64) {
	t.Helper()
	now := time.Now()
	if err := sqlitex.DB.Exec(
		"INSERT INTO credit_accounts (user_id, subscription_balance, topup_balance, period_end, updated_at) VALUES (?, ?, ?, ?, ?) "+
			"ON CONFLICT(user_id) DO UPDATE SET subscription_balance = excluded.subscription_balance, topup_balance = excluded.topup_balance, "+
			"period_end = excluded.period_end, updated_at = excluded.updated_at",
		userID, subscription, topup, now.Add(30*24*time.Hour).Unix(), now.UnixMilli()).Error; err != nil {
		t.Fatalf("seed paid pools: %v", err)
	}
}

func loadAccount(t *testing.T, userID string) sqlitex.CreditAccount {
	t.Helper()
	var acc sqlitex.CreditAccount
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&acc).Error; err != nil {
		t.Fatalf("load credit_accounts row: %v", err)
	}
	return acc
}

func seedCreditUser(t *testing.T, id string) {
	t.Helper()
	if err := sqlitex.DB.Exec("INSERT INTO users (id) VALUES (?) ON CONFLICT(id) DO NOTHING", id).Error; err != nil {
		t.Fatal(err)
	}
}
