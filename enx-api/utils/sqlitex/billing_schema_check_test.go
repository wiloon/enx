package sqlitex

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// initializedDatabase creates a current-schema database at a fresh path and
// closes it, so the file can be inspected and reopened.
func initializedDatabase(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "billing.db")
	previous := DB
	t.Cleanup(func() { DB = previous })
	if err := InitWithLogLevel(path, "error"); err != nil {
		t.Fatal(err)
	}
	raw, err := DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

// execOnFile runs statements on the database file at path outside DB.
func execOnFile(t *testing.T, path string, statements ...string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := raw.Close(); err != nil {
			t.Error(err)
		}
	}()
	for _, statement := range statements {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("%s: %v", statement, err)
		}
	}
}

// legacyStatements reads a pre-cutover billing fixture as SQL statements.
func legacyStatements(t *testing.T, name string) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "testdata", "billing-legacy", name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var lines []string
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			lines = append(lines, line)
		}
	}
	var statements []string
	for _, s := range strings.Split(strings.Join(lines, "\n"), ";") {
		if s = strings.TrimSpace(s); s != "" {
			statements = append(statements, s)
		}
	}
	return statements
}

// assertStartupRefusesUnchanged runs startup on path and expects it to
// refuse the billing schema without writing a byte of the file.
func assertStartupRefusesUnchanged(t *testing.T, path string) {
	t.Helper()
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	previous := DB
	t.Cleanup(func() { DB = previous })

	err = InitWithLogLevel(path, "error")

	if err == nil || !strings.Contains(err.Error(), "unsupported billing schema") {
		t.Fatalf("InitWithLogLevel = %v, want unsupported billing schema", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("a refused database was written to")
	}
}

func TestCheckBillingSchemaAcceptsAnInitializedDatabase(t *testing.T) {
	path := initializedDatabase(t)

	if err := CheckBillingSchema(path); err != nil {
		t.Fatalf("CheckBillingSchema = %v, want nil for a current schema", err)
	}
}

func TestReopeningACurrentDatabaseRestoresDroppedColumnsAndKeepsBillingState(t *testing.T) {
	path := initializedDatabase(t)
	execOnFile(t, path,
		"INSERT INTO users (id, accepted_subscription_id) VALUES ('u_subscribed', 'sub_subscribed')",
		"INSERT INTO subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, created_at, updated_at) VALUES ('sub_subscribed', 'u_subscribed', 'cus_subscribed', 'active', 1, 1)",
		"INSERT INTO credit_accounts (user_id, subscription_balance, updated_at) VALUES ('u_subscribed', 500, 1)",
		"ALTER TABLE users DROP COLUMN avatar_url",
		"ALTER TABLE credit_accounts DROP COLUMN trial_expires_at",
		"ALTER TABLE credit_transactions DROP COLUMN note",
	)
	previous := DB
	t.Cleanup(func() { DB = previous })

	if err := InitWithLogLevel(path, "error"); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	t.Cleanup(func() {
		if raw, err := DB.DB(); err == nil {
			_ = raw.Close()
		}
	})

	for table, column := range map[string]string{"users": "avatar_url", "credit_accounts": "trial_expires_at", "credit_transactions": "note"} {
		if !DB.Migrator().HasColumn(table, column) {
			t.Errorf("%s.%s was not restored", table, column)
		}
	}
	if !DB.Migrator().HasColumn("users", "billing_version") {
		t.Error("lost users.billing_version")
	}
	if !DB.Migrator().HasIndex("credit_transactions", "idx_credit_transactions_subscription_invoice") {
		t.Error("lost subscription invoice uniqueness")
	}
	var account struct {
		Accepted string
		Balance  int64
	}
	if err := DB.Raw("SELECT u.accepted_subscription_id AS accepted, c.subscription_balance AS balance FROM users u JOIN credit_accounts c ON c.user_id = u.id WHERE u.id = 'u_subscribed'").Scan(&account).Error; err != nil {
		t.Fatal(err)
	}
	if account.Accepted != "sub_subscribed" || account.Balance != 500 {
		t.Fatalf("account changed on reopen: %+v", account)
	}
}

func TestStartupRefusesALegacyBillingDatabaseBeforeChangingIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	execOnFile(t, path, append(legacyStatements(t, "schema.sql"), legacyStatements(t, "subscribed.sql")...)...)

	assertStartupRefusesUnchanged(t, path)
}

func TestStartupRefusesAnUnknownBillingSchemaVersionBeforeWrites(t *testing.T) {
	path := initializedDatabase(t)
	execOnFile(t, path, "INSERT INTO schema_migrations VALUES ('future-billing-version', 1)")

	assertStartupRefusesUnchanged(t, path)
}

func TestStartupRefusesADamagedCurrentBillingSchemaBeforeWrites(t *testing.T) {
	for _, tc := range []struct {
		name string
		sql  []string
	}{
		{"missing event alert column", []string{"ALTER TABLE stripe_webhook_events DROP COLUMN alert_attempts"}},
		{"missing conflict alert column", []string{"ALTER TABLE subscriptions DROP COLUMN conflict_alert_claim_token"}},
		{"nonunique invoice index", []string{"DROP INDEX idx_credit_transactions_subscription_invoice", "CREATE INDEX idx_credit_transactions_subscription_invoice ON credit_transactions(stripe_invoice_id) WHERE type='GRANT_SUBSCRIPTION' AND stripe_invoice_id IS NOT NULL"}},
		{"missing scoped event key", []string{"ALTER TABLE stripe_webhook_events RENAME TO old_events", "CREATE TABLE stripe_webhook_events AS SELECT * FROM old_events", "DROP TABLE old_events"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := initializedDatabase(t)
			execOnFile(t, path, tc.sql...)

			assertStartupRefusesUnchanged(t, path)
		})
	}
}
