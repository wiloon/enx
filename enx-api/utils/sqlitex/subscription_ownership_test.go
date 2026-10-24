package sqlitex

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
)

// The #297 legacy billing fixtures: the pre-cutover schema and one file of
// rows per kind of existing data.
const legacyBillingFixtures = "../../testdata/billing-legacy"

// legacyBillingDB opens a file database with the pre-cutover billing schema
// and the rows of the named fixtures.
func legacyBillingDB(t *testing.T, fixtures ...string) *gorm.DB {
	t.Helper()
	db := openFixture(t, filepath.Join(t.TempDir(), "enx.db"), "")
	for _, name := range append([]string{"schema.sql"}, fixtures...) {
		execAll(t, db, fixtureStatements(t, name)...)
	}
	return db
}

func fixtureStatements(t *testing.T, name string) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(legacyBillingFixtures, name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var lines []string
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			lines = append(lines, line)
		}
	}
	var out []string
	for _, s := range strings.Split(strings.Join(lines, "\n"), ";") {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

type migratedSubscription struct {
	StripeSubscriptionId string
	UserId               string
	StripeCustomerId     string
	Status               string
	Plan                 string
	CurrentPeriodEnd     int64
	Classification       string
	Version              int64
	CreatedAt            int64
	UpdatedAt            int64
}

func migratedSubscriptions(t *testing.T, db *gorm.DB) []migratedSubscription {
	t.Helper()
	var rows []migratedSubscription
	if err := db.Raw(`SELECT stripe_subscription_id, user_id, stripe_customer_id, status, plan,
		current_period_end, classification, version, created_at, updated_at
		FROM subscriptions ORDER BY stripe_subscription_id`).Scan(&rows).Error; err != nil {
		t.Fatalf("read subscriptions: %v", err)
	}
	return rows
}

type ownedCustomer struct {
	StripeCustomerId string
	UserId           string
}

func ownedCustomers(t *testing.T, db *gorm.DB) []ownedCustomer {
	t.Helper()
	var rows []ownedCustomer
	if err := db.Raw(`SELECT stripe_customer_id, user_id FROM stripe_customers ORDER BY stripe_customer_id`).Scan(&rows).Error; err != nil {
		t.Fatalf("read stripe_customers: %v", err)
	}
	return rows
}

// acceptedPointers maps each users row to its accepted subscription ("" for
// NULL).
func acceptedPointers(t *testing.T, db *gorm.DB) map[string]string {
	t.Helper()
	var rows []struct {
		Id                     string
		AcceptedSubscriptionId *string
	}
	if err := db.Raw(`SELECT id, accepted_subscription_id FROM users`).Scan(&rows).Error; err != nil {
		t.Fatalf("read users: %v", err)
	}
	out := map[string]string{}
	for _, r := range rows {
		out[r.Id] = ""
		if r.AcceptedSubscriptionId != nil {
			out[r.Id] = *r.AcceptedSubscriptionId
		}
	}
	return out
}

func TestSubscriptionOwnershipMigrationMovesALiveSubscriberAndAcceptsIt(t *testing.T) {
	db := legacyBillingDB(t, "subscribed.sql")

	res, err := MigrateSubscriptionOwnership(db)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if !res.Applied {
		t.Fatalf("Applied = false, want the first run to apply the migration")
	}

	want := []migratedSubscription{{
		StripeSubscriptionId: "sub_subscribed", UserId: "u_subscribed", StripeCustomerId: "cus_subscribed",
		Status: "active", Plan: "pro-plus", CurrentPeriodEnd: 1800000000, Classification: "accepted",
		Version: 1, CreatedAt: 1788000000000, UpdatedAt: 1788000000000,
	}}
	if got := migratedSubscriptions(t, db); len(got) != 1 || got[0] != want[0] {
		t.Fatalf("subscriptions = %+v, want %+v", got, want)
	}
	if got := ownedCustomers(t, db); len(got) != 1 || got[0] != (ownedCustomer{"cus_subscribed", "u_subscribed"}) {
		t.Fatalf("stripe_customers = %+v, want cus_subscribed owned by u_subscribed", got)
	}
	if got := acceptedPointers(t, db); got["u_subscribed"] != "sub_subscribed" {
		t.Fatalf("accepted pointers = %v, want u_subscribed -> sub_subscribed", got)
	}
}

func TestSubscriptionOwnershipMigrationOfEachKindOfLegacyData(t *testing.T) {
	cases := []struct {
		name      string
		fixture   string
		subs      []migratedSubscription
		customers []ownedCustomer
		pointers  map[string]string
	}{
		{
			name:      "a top-up-only Customer creates no subscription",
			fixture:   "topup-only.sql",
			customers: []ownedCustomer{{"cus_topup", "u_topup"}},
			pointers:  map[string]string{"u_topup": ""},
		},
		{
			name:    "an ended subscription stays accepted history",
			fixture: "ended.sql",
			subs: []migratedSubscription{{
				StripeSubscriptionId: "sub_ended", UserId: "u_ended", StripeCustomerId: "cus_ended",
				Status: "canceled", Plan: "pro", CurrentPeriodEnd: 1700000000, Classification: "accepted",
				Version: 1, CreatedAt: 1780000000000, UpdatedAt: 1790000000000,
			}},
			customers: []ownedCustomer{{"cus_ended", "u_ended"}},
			pointers:  map[string]string{"u_ended": "sub_ended"},
		},
		{
			name:    "a deleted user's retained subscription is kept without recreating the user",
			fixture: "deleted-user.sql",
			subs: []migratedSubscription{{
				StripeSubscriptionId: "sub_deleted", UserId: "u_deleted", StripeCustomerId: "cus_deleted",
				Status: "canceled", Plan: "pro", CurrentPeriodEnd: 1700000000, Classification: "accepted",
				Version: 1, CreatedAt: 1780000000000, UpdatedAt: 1790000000000,
			}},
			customers: []ownedCustomer{{"cus_deleted", "u_deleted"}},
			pointers:  map[string]string{},
		},
		{
			name:    "an overwritten subscription is not invented from its ledger grant",
			fixture: "overwritten-subscription.sql",
			subs: []migratedSubscription{{
				StripeSubscriptionId: "sub_second", UserId: "u_overwritten", StripeCustomerId: "cus_second",
				Status: "active", Plan: "max", CurrentPeriodEnd: 1800000000, Classification: "accepted",
				Version: 1, CreatedAt: 1788000000000, UpdatedAt: 1788000001000,
			}},
			customers: []ownedCustomer{{"cus_second", "u_overwritten"}},
			pointers:  map[string]string{"u_overwritten": "sub_second"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db := legacyBillingDB(t, tc.fixture)
			ledger := dumpTables(t, db, "credit_accounts", "credit_transactions")

			if _, err := MigrateSubscriptionOwnership(db); err != nil {
				t.Fatalf("migrate: %v", err)
			}

			if got := migratedSubscriptions(t, db); fmt.Sprint(got) != fmt.Sprint(tc.subs) {
				t.Errorf("subscriptions = %+v, want %+v", got, tc.subs)
			}
			if got := ownedCustomers(t, db); fmt.Sprint(got) != fmt.Sprint(tc.customers) {
				t.Errorf("stripe_customers = %+v, want %+v", got, tc.customers)
			}
			if got := acceptedPointers(t, db); fmt.Sprint(got) != fmt.Sprint(tc.pointers) {
				t.Errorf("users and their accepted subscription = %v, want %v", got, tc.pointers)
			}
			if got := dumpTables(t, db, "credit_accounts", "credit_transactions"); got != ledger {
				t.Errorf("the credit balances or ledger changed.\nbefore:\n%s\nafter:\n%s", ledger, got)
			}
		})
	}
}

// legacyTables are the tables the migration reads or rewrites.
var legacyTables = []string{"users", "subscriptions", "credit_accounts", "credit_transactions", "stripe_customers", "schema_migrations"}

func TestSubscriptionOwnershipMigrationStopsOnAmbiguousDataAndChangesNothing(t *testing.T) {
	cases := []struct {
		name  string
		setup func(t *testing.T) *gorm.DB
		want  []string // each must appear in the error
	}{
		{
			name:  "the ambiguous fixture",
			setup: func(t *testing.T) *gorm.DB { return legacyBillingDB(t, "subscribed.sql", "ambiguous.sql") },
			want: []string{
				`user "u_active_without_subscription": status "active" but no Stripe Subscription ID`,
				`subscription "sub_legacy_plan": plan "monthly" is not a current tier`,
				`user "u_ledger_without_subscription": GRANT_SUBSCRIPTION ledger rows but no subscription to attribute them to`,
			},
		},
		{
			name: "a row with no owner or no Customer",
			setup: func(t *testing.T) *gorm.DB {
				db := legacyBillingDB(t)
				execAll(t, db,
					"INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, created_at, updated_at) VALUES (NULL, 'cus_no_owner', 'sub_no_owner', 'active', 'pro', 1800000000, 1, 1)",
					"INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, created_at, updated_at) VALUES ('u_blank_customer', '  ', NULL, 'none', NULL, NULL, 1, 1)",
				)
				return db
			},
			want: []string{
				`Customer "cus_no_owner": no owning user`,
				`user "u_blank_customer": blank Stripe Customer ID`,
			},
		},
		{
			name: "duplicate or blank IDs where the legacy unique indexes are missing",
			setup: func(t *testing.T) *gorm.DB {
				db := legacyBillingDB(t)
				execAll(t, db,
					"DROP INDEX idx_subscriptions_stripe_subscription_id",
					"DROP INDEX idx_subscriptions_stripe_customer_id",
					"INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, created_at, updated_at) VALUES ('u_dup_1', 'cus_dup', 'sub_dup', 'active', 'pro', 1800000000, 1, 1)",
					"INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, created_at, updated_at) VALUES ('u_dup_2', 'cus_dup', 'sub_dup', 'active', 'pro', 1800000000, 1, 1)",
					"INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, created_at, updated_at) VALUES ('u_blank_sub', 'cus_blank_sub', '', 'active', 'pro', 1800000000, 1, 1)",
				)
				return db
			},
			want: []string{
				`subscription "sub_dup": on more than one row`,
				`Customer "cus_dup": on more than one row`,
				`user "u_blank_sub": blank Stripe Subscription ID`,
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db := tc.setup(t)
			before := dumpTables(t, db, legacyTables...)

			res, err := MigrateSubscriptionOwnership(db)
			if err == nil {
				t.Fatalf("migrate succeeded (%+v), want the preflight to stop", res)
			}
			for _, w := range tc.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("error %q does not name %q", err, w)
				}
			}
			if after := dumpTables(t, db, legacyTables...); after != before {
				t.Errorf("a stopped migration changed the database.\nbefore:\n%s\nafter:\n%s", before, after)
			}
		})
	}
}

var errInjected = errors.New("injected failure")

func TestAFailedSubscriptionOwnershipMigrationLeavesTheLegacyDataIntact(t *testing.T) {
	fixtures := []string{"subscribed.sql", "ended.sql", "topup-only.sql", "deleted-user.sql", "overwritten-subscription.sql"}
	for _, step := range []string{ownershipStepCustomers, ownershipStepSubscriptions, ownershipStepPointers} {
		t.Run("failing after "+step, func(t *testing.T) {
			db := legacyBillingDB(t, fixtures...)
			before := dumpTables(t, db, legacyTables...)

			failing := subscriptionOwnership{now: func() time.Time { return time.Unix(0, 0) }, afterStep: func(s string, _ *gorm.DB) error {
				if s == step {
					return errInjected
				}
				return nil
			}}
			if _, err := failing.run(db); !errors.Is(err, errInjected) {
				t.Fatalf("migrate error = %v, want the injected failure", err)
			}
			if after := dumpTables(t, db, legacyTables...); after != before {
				t.Fatalf("a failed migration changed the database.\nbefore:\n%s\nafter:\n%s", before, after)
			}

			res, err := MigrateSubscriptionOwnership(db)
			if err != nil || !res.Applied {
				t.Fatalf("rerun = %+v, %v; want it to apply", res, err)
			}
			if got := acceptedPointers(t, db); got["u_subscribed"] != "sub_subscribed" {
				t.Fatalf("after the rerun, accepted pointers = %v, want u_subscribed -> sub_subscribed", got)
			}
		})
	}
}

func TestSubscriptionOwnershipMigrationRefusesASchemaThatIsNoLongerLegacy(t *testing.T) {
	db := legacyBillingDB(t, "subscribed.sql")
	earlier := subscriptionOwnership{now: func() time.Time { return time.Unix(0, 0) }}
	if _, err := earlier.run(db); err != nil {
		t.Fatalf("first run: %v", err)
	}
	execAll(t, db, "DELETE FROM schema_migrations")
	before := dumpTables(t, db, legacyTables...)

	_, err := MigrateSubscriptionOwnership(db)
	if err == nil || !strings.Contains(err.Error(), "subscriptions is not the legacy user-keyed table") {
		t.Fatalf("migrate error = %v, want it to refuse the already rebuilt subscriptions table", err)
	}
	if after := dumpTables(t, db, legacyTables...); after != before {
		t.Fatalf("a refused migration changed the database.\nbefore:\n%s\nafter:\n%s", before, after)
	}
}

func TestSubscriptionOwnershipMigrationBacksTheLegacyDatabaseUpFirst(t *testing.T) {
	db := legacyBillingDB(t, "subscribed.sql", "topup-only.sql")
	at := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)

	res, err := subscriptionOwnership{now: func() time.Time { return at }}.run(db)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if !strings.HasSuffix(res.Backup, ".pre-subscription-ownership-20261024T120000Z") {
		t.Fatalf("Backup = %q, want a timestamped copy next to the database", res.Backup)
	}
	backup := openFixture(t, res.Backup, "")
	var rows []struct {
		UserId           string
		StripeCustomerId string
	}
	if err := backup.Raw("SELECT user_id, stripe_customer_id FROM subscriptions ORDER BY user_id").Scan(&rows).Error; err != nil {
		t.Fatalf("read the backup's legacy subscriptions: %v", err)
	}
	if fmt.Sprint(rows) != "[{u_subscribed cus_subscribed} {u_topup cus_topup}]" {
		t.Fatalf("backup subscriptions = %v, want both legacy rows", rows)
	}
}

func TestSubscriptionOwnershipMigrationWritesNoBackupWhenItDoesNotRun(t *testing.T) {
	cases := []struct {
		name  string
		setup func(t *testing.T, db *gorm.DB)
	}{
		{"the preflight stops", func(t *testing.T, db *gorm.DB) { execAll(t, db, fixtureStatements(t, "ambiguous.sql")...) }},
		{"it already ran", func(t *testing.T, db *gorm.DB) {
			earlier := subscriptionOwnership{now: func() time.Time { return time.Unix(0, 0) }}
			if _, err := earlier.run(db); err != nil {
				t.Fatalf("first run: %v", err)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db := legacyBillingDB(t, "subscribed.sql")
			tc.setup(t, db)
			dir := filepath.Dir(databaseFile(t, db))
			existing := backupsIn(t, dir)

			res, _ := MigrateSubscriptionOwnership(db)
			if res.Backup != "" {
				t.Errorf("Backup = %q, want none", res.Backup)
			}
			if got := backupsIn(t, dir); got != existing {
				t.Errorf("backups in the database directory = %d, want %d", got, existing)
			}
		})
	}
}

func databaseFile(t *testing.T, db *gorm.DB) string {
	t.Helper()
	var files []struct {
		Name string
		File string
	}
	if err := db.Raw(`PRAGMA database_list`).Scan(&files).Error; err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		if f.Name == "main" {
			return f.File
		}
	}
	t.Fatal("no main database file")
	return ""
}

func backupsIn(t *testing.T, dir string) int {
	t.Helper()
	found, err := filepath.Glob(filepath.Join(dir, "*.pre-subscription-ownership-*"))
	if err != nil {
		t.Fatal(err)
	}
	return len(found)
}

func TestSubscriptionOwnershipMigrationReportsWhatItMoved(t *testing.T) {
	db := legacyBillingDB(t, "subscribed.sql", "ended.sql", "topup-only.sql", "deleted-user.sql", "overwritten-subscription.sql")

	res, err := MigrateSubscriptionOwnership(db)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// Five Customers; four real Subscription IDs (not the top-up's); three
	// owners still have a users row (not the deleted one).
	if res.Customers != 5 || res.Subscriptions != 4 || res.AcceptedPointers != 3 {
		t.Fatalf("result = %+v, want 5 Customers, 4 subscriptions, 3 accepted pointers", res)
	}
}

func TestSubscriptionOwnershipMigrationRunsOnlyOnce(t *testing.T) {
	db := legacyBillingDB(t, "subscribed.sql", "topup-only.sql")
	if _, err := MigrateSubscriptionOwnership(db); err != nil {
		t.Fatalf("first run: %v", err)
	}
	before := dumpTables(t, db, "users", "subscriptions", "stripe_customers", "credit_accounts", "credit_transactions", "schema_migrations")

	res, err := MigrateSubscriptionOwnership(db)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if res.Applied {
		t.Fatalf("second run Applied = true, want the completion marker to stop it")
	}
	if after := dumpTables(t, db, "users", "subscriptions", "stripe_customers", "credit_accounts", "credit_transactions", "schema_migrations"); after != before {
		t.Fatalf("the second run changed the database.\nbefore:\n%s\nafter:\n%s", before, after)
	}
}

// dumpTables renders every row of the tables, in a stable order, and their
// DDL, so two dumps compare equal only when nothing changed.
func dumpTables(t *testing.T, db *gorm.DB, tables ...string) string {
	t.Helper()
	var b strings.Builder
	for _, table := range tables {
		var ddl []string
		if err := db.Raw(`SELECT sql FROM sqlite_schema WHERE tbl_name = ? AND sql IS NOT NULL ORDER BY type, name`, table).Scan(&ddl).Error; err != nil {
			t.Fatalf("read %s DDL: %v", table, err)
		}
		b.WriteString(strings.Join(ddl, ";\n") + "\n")
		if len(ddl) == 0 {
			continue
		}
		rows, err := db.Raw(`SELECT * FROM ` + quoteIdent(table) + ` ORDER BY 1`).Rows()
		if err != nil {
			t.Fatalf("read %s: %v", table, err)
		}
		cols, _ := rows.Columns()
		for rows.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				t.Fatalf("scan %s: %v", table, err)
			}
			fmt.Fprintf(&b, "%s %v\n", table, vals)
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("read %s: %v", table, err)
		}
		_ = rows.Close()
	}
	return b.String()
}
