package sqlitex

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// Historical forms of the users table (#211). Each carries single-column
// uniqueness on email and name that the rebuild must remove, and everything
// else it must keep.
var usersFixtures = []struct {
	name string
	ddl  []string
}{
	{
		// glebarez/GORM before named constraints: column-level UNIQUE.
		name: "column-level UNIQUE",
		ddl: []string{
			"CREATE TABLE `users` (`id` text,`clerk_user_id` text,`name` text UNIQUE,`email` text UNIQUE,`password` text,`status` text DEFAULT \"pending\",`created_at` datetime,`updated_at` datetime,`last_login_time` datetime,PRIMARY KEY (`id`))",
			"CREATE UNIQUE INDEX `idx_users_clerk_user_id` ON `users`(`clerk_user_id`)",
		},
	},
	{
		// schema.sql: INTEGER primary key, legacy columns, unnamed
		// table-level UNIQUE; later columns added by ALTER TABLE.
		name: "unnamed table-level UNIQUE with an INTEGER primary key",
		ddl: []string{
			"CREATE TABLE users (\n  `id` INTEGER PRIMARY KEY AUTOINCREMENT,\n  `name` varchar(256) NOT NULL,\n  `email` varchar(256) NOT NULL,\n  `password` varchar(256) NOT NULL,\n  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  `update_time` datetime DEFAULT NULL,\n  `last_login_time` datetime DEFAULT NULL,\n  UNIQUE (`name`),\n  UNIQUE (`email`)\n)",
			"ALTER TABLE users ADD COLUMN `clerk_user_id` text",
			"ALTER TABLE users ADD COLUMN `status` text DEFAULT 'pending'",
			"CREATE UNIQUE INDEX `idx_users_clerk_user_id` ON `users`(`clerk_user_id`)",
		},
	},
	{
		// Today's GORM model before #211.
		name: "named table-level constraints",
		ddl: []string{
			"CREATE TABLE `users` (`id` text,`clerk_user_id` text,`name` text,`email` text,`password` text,`status` text DEFAULT \"pending\",`verification_token` text,`token_expires_at` datetime,`reset_token` text,`reset_token_expires_at` datetime,`created_at` datetime,`updated_at` datetime,`last_login_time` datetime,PRIMARY KEY (`id`),CONSTRAINT `uni_users_name` UNIQUE (`name`),CONSTRAINT `uni_users_email` UNIQUE (`email`))",
			"CREATE UNIQUE INDEX `idx_users_clerk_user_id` ON `users`(`clerk_user_id`)",
		},
	},
	{
		name: "standalone unique indexes",
		ddl: []string{
			"CREATE TABLE users (id TEXT PRIMARY KEY, clerk_user_id TEXT, name TEXT, email TEXT, status TEXT, created_at datetime)",
			`CREATE UNIQUE INDEX "IDX_Users_Email" ON "USERS" ("Email")`,
			"CREATE UNIQUE INDEX idx_users_name ON users(name COLLATE NOCASE)",
			"CREATE UNIQUE INDEX idx_users_clerk_user_id ON users(clerk_user_id)",
			"CREATE UNIQUE INDEX idx_users_email_clerk ON users(email, clerk_user_id)",
		},
	},
	{
		name: "quoted identifiers, comments and legacy extras",
		ddl: []string{
			"CREATE TABLE [users] (\n" +
				"  [id] TEXT NOT NULL PRIMARY KEY, -- the enx id, never the Clerk one\n" +
				"  \"Name\" VARCHAR(256) NOT NULL DEFAULT 'nobody, unique' CONSTRAINT \"uq name\" UNIQUE ON CONFLICT ABORT,\n" +
				"  `EMAIL` varchar(256) NOT NULL COLLATE NOCASE unique,\n" +
				"  clerk_user_id TEXT,\n" +
				"  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'unique')),\n" +
				"  /* gone, but kept */ legacy_score REAL DEFAULT 1.5,\n" +
				"  created_at datetime,\n" +
				"  CONSTRAINT users_email_clerk UNIQUE (email, clerk_user_id)\n" +
				")",
			"CREATE UNIQUE INDEX idx_users_clerk_user_id ON users(clerk_user_id)",
		},
	},
}

// usersFixtureDependents are tables, a view and triggers that refer to users.
var usersFixtureDependents = []string{
	"CREATE TABLE credit_accounts (user_id REFERENCES users(id), topup_balance INTEGER)",
	"CREATE TABLE lookup_events (id INTEGER PRIMARY KEY, user_id REFERENCES users(id), at INTEGER)",
	"CREATE TABLE trial_grants (email_hash TEXT PRIMARY KEY, user_id REFERENCES users(id))",
	"CREATE INDEX idx_users_status ON users(status)",
	"CREATE VIEW active_users AS SELECT id, email FROM users WHERE status = 'active'",
	"CREATE VIEW active_emails AS SELECT email FROM active_users",
	"CREATE TRIGGER users_status_audit AFTER UPDATE OF status ON users BEGIN INSERT INTO lookup_events (user_id, at) VALUES (NEW.id, -1); END",
	"CREATE TRIGGER lookup_needs_user BEFORE INSERT ON lookup_events BEGIN SELECT RAISE(ABORT, 'no such user') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id); END",
}

func openFixture(t *testing.T, path string, dsnSuffix string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(path+dsnSuffix), &gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}

func execAll(t *testing.T, db *gorm.DB, stmts ...string) {
	t.Helper()
	for _, s := range stmts {
		if err := db.Exec(s).Error; err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
}

// seedUsers fills every column of two users and returns their ids.
func seedUsers(t *testing.T, db *gorm.DB) []any {
	t.Helper()
	cols, err := tableColumns(db, "users")
	if err != nil {
		t.Fatal(err)
	}
	var ids []any
	for n := 1; n <= 2; n++ {
		var names, marks []string
		var vals []any
		var id any
		for _, c := range cols {
			names = append(names, quoteIdent(c.Name))
			marks = append(marks, "?")
			var v any
			switch strings.ToLower(c.Name) {
			case "id":
				if strings.EqualFold(c.Type, "INTEGER") {
					v = int64(40 + n)
				} else {
					v = fmt.Sprintf("0b6f%d-uuid", n)
				}
				id = v
			case "email":
				v = fmt.Sprintf("Reader%d@Example.com", n)
			case "name":
				v = fmt.Sprintf("Reader %d", n)
			case "clerk_user_id":
				v = fmt.Sprintf("user_clerk%d", n)
			case "status":
				v = "active"
			case "legacy_score":
				v = 2.25 * float64(n)
			default:
				if strings.Contains(strings.ToLower(c.Type), "date") {
					v = fmt.Sprintf("2026-0%d-0%d 10:11:12.5+00:00", n, n)
				} else {
					v = fmt.Sprintf("%s-%d", c.Name, n)
				}
			}
			vals = append(vals, v)
		}
		if err := db.Exec(fmt.Sprintf("INSERT INTO users (%s) VALUES (%s)", strings.Join(names, ","), strings.Join(marks, ",")), vals...).Error; err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	return ids
}

// copyFirstUser inserts a copy of the first user, same email and name, under
// another id and Clerk user id.
func copyFirstUser(t *testing.T, db *gorm.DB, id int, clerkUserID string) error {
	t.Helper()
	cols, err := tableColumns(db, "users")
	if err != nil {
		t.Fatal(err)
	}
	var names, picks []string
	var args []any
	for _, c := range cols {
		names = append(names, quoteIdent(c.Name))
		switch strings.ToLower(c.Name) {
		case "id":
			picks, args = append(picks, "?"), append(args, id)
		case "clerk_user_id":
			picks, args = append(picks, "?"), append(args, clerkUserID)
		default:
			picks = append(picks, quoteIdent(c.Name))
		}
	}
	return db.Exec(fmt.Sprintf("INSERT INTO users (%s) SELECT %s FROM users ORDER BY rowid LIMIT 1",
		strings.Join(names, ","), strings.Join(picks, ",")), args...).Error
}

// seedDependents gives each user rows in the fixture's dependent tables.
func seedDependents(t *testing.T, db *gorm.DB, ids []any) {
	t.Helper()
	for _, id := range ids {
		for _, q := range []string{
			"INSERT INTO credit_accounts (user_id, topup_balance) VALUES (?, 500)",
			"INSERT INTO lookup_events (user_id, at) VALUES (?, 1760000000000)",
			"INSERT INTO trial_grants (email_hash, user_id) VALUES ('hash-' || ?, ?)",
		} {
			args := []any{id}
			if strings.Count(q, "?") == 2 {
				args = append(args, id)
			}
			if err := db.Exec(q, args...).Error; err != nil {
				t.Fatalf("%s: %v", q, err)
			}
		}
	}
}

func newFixture(t *testing.T, ddl []string) (string, *gorm.DB) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "enx.db")
	db := openFixture(t, path, "")
	execAll(t, db, ddl...)
	execAll(t, db, usersFixtureDependents...)
	seedDependents(t, db, seedUsers(t, db))
	return path, db
}

func dumpRows(t *testing.T, db *gorm.DB, table string) string {
	t.Helper()
	var rows []map[string]any
	if err := db.Raw(fmt.Sprintf("SELECT * FROM %s ORDER BY rowid", table)).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return fmt.Sprint(rows)
}

// dumpData is every row of users and the tables that refer to it.
func dumpData(t *testing.T, db *gorm.DB) string {
	t.Helper()
	var b strings.Builder
	for _, table := range []string{"users", "credit_accounts", "lookup_events", "trial_grants"} {
		b.WriteString(table + ": " + dumpRows(t, db, table) + "\n")
	}
	return b.String()
}

// schemaOf is every schema object but users' own DDL and the indexes SQLite
// makes for constraints.
func schemaOf(t *testing.T, db *gorm.DB) []string {
	t.Helper()
	var rows []struct{ Type, Name, Sql string }
	if err := db.Raw(`SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND NOT (type = 'table' AND name = 'users') ORDER BY type, name`).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, r := range rows {
		out = append(out, r.Type+" "+r.Name+": "+r.Sql)
	}
	return out
}

func usersDDLOf(t *testing.T, db *gorm.DB) string {
	t.Helper()
	var ddl string
	if err := db.Raw(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'users'`).Scan(&ddl).Error; err != nil {
		t.Fatal(err)
	}
	return ddl
}

// profileUniqueness names the single-column unique indexes on email or name.
func profileUniqueness(t *testing.T, db *gorm.DB) []string {
	t.Helper()
	indexes, err := listUsersIndexes(db, "users")
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, ix := range indexes {
		if ix.isProfileUnique() {
			out = append(out, ix.cols[0])
		}
	}
	sort.Strings(out)
	return out
}

func backupsOf(t *testing.T, path string) []string {
	t.Helper()
	matches, err := filepath.Glob(path + backupSuffix + "*")
	if err != nil {
		t.Fatal(err)
	}
	return matches
}

var rebuildClock = func() time.Time { return time.Date(2026, 10, 22, 5, 34, 36, 0, time.UTC) }

func TestUsersRebuild_RemovesProfileUniquenessFromEveryHistoricalForm(t *testing.T) {
	for _, fx := range usersFixtures {
		t.Run(fx.name, func(t *testing.T) {
			path, db := newFixture(t, fx.ddl)
			if got := profileUniqueness(t, db); fmt.Sprint(got) != "[email name]" {
				t.Fatalf("fixture uniqueness = %v, want [email name]", got)
			}
			beforeData, beforeSchema := dumpData(t, db), schemaOf(t, db)

			backup, err := usersRebuild{now: rebuildClock}.run(db)
			if err != nil {
				t.Fatalf("rebuild: %v", err)
			}

			if want := path + ".pre-users-rebuild-20261022T053436Z"; backup != want {
				t.Fatalf("backup = %q, want %q", backup, want)
			}
			if got := profileUniqueness(t, db); len(got) != 0 {
				t.Fatalf("still unique: %v\n%s", got, usersDDLOf(t, db))
			}
			if after := dumpData(t, db); after != beforeData {
				t.Fatalf("data changed:\nbefore %s\nafter  %s", beforeData, after)
			}
			afterSchema := schemaOf(t, db)
			var kept []string
			for _, s := range beforeSchema {
				if !strings.Contains(s, "IDX_Users_Email") && !strings.HasPrefix(s, "index idx_users_name:") {
					kept = append(kept, s)
				}
			}
			if fmt.Sprint(afterSchema) != fmt.Sprint(kept) {
				t.Fatalf("schema objects changed:\nbefore %v\nafter  %v", kept, afterSchema)
			}
			var violations []map[string]any
			if err := db.Raw("PRAGMA foreign_key_check").Scan(&violations).Error; err != nil {
				t.Fatal(err)
			}
			if len(violations) != 0 {
				t.Fatalf("foreign key violations: %v", violations)
			}

			// Duplicate names and emails now go in; a duplicate Clerk id
			// still does not.
			if err := db.Exec("UPDATE users SET email = 'Reader1@Example.com', name = 'Reader 1' WHERE rowid != (SELECT min(rowid) FROM users)").Error; err != nil {
				t.Fatalf("sync a duplicate email and name: %v", err)
			}
			if err := copyFirstUser(t, db, 77, "user_new"); err != nil {
				t.Fatalf("insert a duplicate email and name: %v", err)
			}
			if err := copyFirstUser(t, db, 78, "user_clerk1"); err == nil {
				t.Fatal("a duplicate clerk_user_id went in")
			}

			again, err := usersRebuild{now: func() time.Time { return rebuildClock().Add(time.Hour) }}.run(db)
			if err != nil || again != "" {
				t.Fatalf("second run = %q, %v; want a no-op", again, err)
			}
			if b := backupsOf(t, path); len(b) != 1 {
				t.Fatalf("backups = %v, want only the first", b)
			}
		})
	}
}

func TestUsersRebuild_BackupHoldsTheOriginalTable(t *testing.T) {
	_, db := newFixture(t, usersFixtures[2].ddl)
	before := dumpData(t, db)

	backup, err := usersRebuild{now: rebuildClock}.run(db)
	if err != nil {
		t.Fatal(err)
	}

	old := openFixture(t, backup, "")
	if got := profileUniqueness(t, old); fmt.Sprint(got) != "[email name]" {
		t.Fatalf("backup uniqueness = %v, want the original [email name]", got)
	}
	if got := dumpData(t, old); got != before {
		t.Fatalf("backup data = %s, want %s", got, before)
	}
}

// AUTOINCREMENT never hands out an id it handed out before, even a deleted
// one; the rebuild must not reset that.
func TestUsersRebuild_KeepsTheAutoincrementHighWaterMark(t *testing.T) {
	for _, tc := range []struct {
		name  string
		db    func(t *testing.T) *gorm.DB
		after string
	}{
		{"highest id deleted", func(t *testing.T) *gorm.DB {
			_, db := newFixture(t, usersFixtures[1].ddl)
			return db
		}, "DELETE FROM users WHERE id = 500"},
		{"every row deleted", func(t *testing.T) *gorm.DB {
			db := openFixture(t, filepath.Join(t.TempDir(), "enx.db"), "")
			execAll(t, db, "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, email TEXT UNIQUE, password TEXT)")
			return db
		}, "DELETE FROM users"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := tc.db(t)
			execAll(t, db,
				"INSERT INTO users (id, name, email, password) VALUES (500, 'Gone', 'gone@example.com', 'x')",
				tc.after,
			)

			if _, err := (usersRebuild{now: rebuildClock}).run(db); err != nil {
				t.Fatal(err)
			}

			execAll(t, db, "INSERT INTO users (name, email, password) VALUES ('Next', 'next@example.com', 'x')")
			var next int64
			if err := db.Raw("SELECT id FROM users WHERE name = 'Next'").Scan(&next).Error; err != nil {
				t.Fatal(err)
			}
			if next <= 500 {
				t.Fatalf("next id = %d, want above the deleted 500", next)
			}
		})
	}
}

// assertUntouched checks that a failed run left users exactly as it was.
func assertUntouched(t *testing.T, db *gorm.DB, ddl, data string, schema []string) {
	t.Helper()
	if got := usersDDLOf(t, db); got != ddl {
		t.Fatalf("users DDL changed:\n%s\nwant\n%s", got, ddl)
	}
	if got := dumpData(t, db); got != data {
		t.Fatalf("data changed:\n%s\nwant\n%s", got, data)
	}
	if got := schemaOf(t, db); fmt.Sprint(got) != fmt.Sprint(schema) {
		t.Fatalf("schema changed:\n%v\nwant\n%v", got, schema)
	}
	if got := profileUniqueness(t, db); fmt.Sprint(got) != "[email name]" {
		t.Fatalf("uniqueness = %v, want the original [email name]", got)
	}
	var leftover int64
	if err := db.Raw("SELECT count(*) FROM sqlite_schema WHERE name = 'users_new'").Scan(&leftover).Error; err != nil {
		t.Fatal(err)
	}
	if leftover != 0 {
		t.Fatal("users_new left behind")
	}
}

func TestUsersRebuild_BackupFailureStopsBeforeRebuilding(t *testing.T) {
	path, db := newFixture(t, usersFixtures[2].ddl)
	ddl, data, schema := usersDDLOf(t, db), dumpData(t, db), schemaOf(t, db)
	if err := os.Mkdir(path+".pre-users-rebuild-20261022T053436Z", 0o755); err != nil {
		t.Fatal(err)
	}

	if _, err := (usersRebuild{now: rebuildClock}).run(db); err == nil || !strings.Contains(err.Error(), "backup failed") {
		t.Fatalf("err = %v, want a backup failure", err)
	}
	assertUntouched(t, db, ddl, data, schema)
}

func TestUsersRebuild_FailuresRollBackAndRestoreForeignKeys(t *testing.T) {
	for _, tc := range []struct {
		name    string
		step    string
		tamper  func(tx *gorm.DB) error
		wantErr string
	}{
		{"failure mid-rebuild", stepRenamed, func(*gorm.DB) error { return errors.New("disk full") }, "disk full"},
		{"lost row", stepCopied, func(tx *gorm.DB) error {
			return tx.Exec("DELETE FROM users_new WHERE rowid = (SELECT max(rowid) FROM users_new)").Error
		}, "users_new differs from users"},
		{"changed id", stepCopied, func(tx *gorm.DB) error {
			return tx.Exec("UPDATE users_new SET id = 99 WHERE rowid = (SELECT max(rowid) FROM users_new)").Error
		}, "users_new differs from users"},
		{"broken reference", stepRebuilt, func(tx *gorm.DB) error {
			return tx.Exec("INSERT INTO credit_accounts (user_id, topup_balance) VALUES ('nobody', 1)").Error
		}, "foreign_key_check"},
	} {
		for _, fk := range []int{0, 1} {
			t.Run(fmt.Sprintf("%s, foreign_keys=%d", tc.name, fk), func(t *testing.T) {
				path := filepath.Join(t.TempDir(), "enx.db")
				db := openFixture(t, path, fmt.Sprintf("?_pragma=foreign_keys(%d)", fk))
				execAll(t, db, usersFixtures[2].ddl...)
				execAll(t, db, usersFixtureDependents...)
				seedDependents(t, db, seedUsers(t, db))
				ddl, data, schema := usersDDLOf(t, db), dumpData(t, db), schemaOf(t, db)

				_, err := usersRebuild{now: rebuildClock, afterStep: func(step string, tx *gorm.DB) error {
					if step == tc.step {
						return tc.tamper(tx)
					}
					return nil
				}}.run(db)

				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err = %v, want %q", err, tc.wantErr)
				}
				assertUntouched(t, db, ddl, data, schema)
				var got int
				if err := db.Raw("PRAGMA foreign_keys").Scan(&got).Error; err != nil {
					t.Fatal(err)
				}
				if got != fk {
					t.Fatalf("foreign_keys = %d after the failure, want %d", got, fk)
				}
			})
		}
	}
}

func TestUsersRebuild_RestoresForeignKeysAfterSuccess(t *testing.T) {
	path := filepath.Join(t.TempDir(), "enx.db")
	db := openFixture(t, path, "?_pragma=foreign_keys(1)")
	execAll(t, db, usersFixtures[0].ddl...)
	execAll(t, db, usersFixtureDependents...)
	seedDependents(t, db, seedUsers(t, db))

	if _, err := (usersRebuild{now: rebuildClock}).run(db); err != nil {
		t.Fatal(err)
	}
	var fk int
	if err := db.Raw("PRAGMA foreign_keys").Scan(&fk).Error; err != nil {
		t.Fatal(err)
	}
	if fk != 1 {
		t.Fatalf("foreign_keys = %d, want it back on", fk)
	}
}

// What the rebuild cannot classify stops it before the backup.
func TestUsersRebuild_RefusesUniquenessItCannotClassify(t *testing.T) {
	for _, ix := range []string{
		"CREATE UNIQUE INDEX idx_users_email_live ON users(email) WHERE status = 'active'",
		"CREATE UNIQUE INDEX idx_users_email_lower ON users(lower(email))",
	} {
		t.Run(ix, func(t *testing.T) {
			path, db := newFixture(t, []string{
				"CREATE TABLE users (id TEXT PRIMARY KEY, clerk_user_id TEXT, name TEXT UNIQUE, email TEXT, status TEXT)",
				ix,
			})
			ddl, data, schema := usersDDLOf(t, db), dumpData(t, db), schemaOf(t, db)

			if _, err := (usersRebuild{now: rebuildClock}).run(db); err == nil || !strings.Contains(err.Error(), "cannot classify") {
				t.Fatalf("err = %v, want a refusal", err)
			}
			if got := usersDDLOf(t, db); got != ddl || dumpData(t, db) != data || fmt.Sprint(schemaOf(t, db)) != fmt.Sprint(schema) {
				t.Fatal("users changed")
			}
			if b := backupsOf(t, path); len(b) != 0 {
				t.Fatalf("backups = %v, want none", b)
			}
		})
	}
}

func TestUsersRebuild_NothingToDo(t *testing.T) {
	for _, tc := range []struct {
		name string
		ddl  []string
	}{
		{"no users table", nil},
		{"no profile uniqueness", []string{
			"CREATE TABLE users (id TEXT PRIMARY KEY, clerk_user_id TEXT, name TEXT, email TEXT, status TEXT)",
			"CREATE UNIQUE INDEX idx_users_clerk_user_id ON users(clerk_user_id)",
			"CREATE UNIQUE INDEX idx_users_email_clerk ON users(email, clerk_user_id)",
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "enx.db")
			db := openFixture(t, path, "")
			execAll(t, db, tc.ddl...)
			before := fmt.Sprint(schemaOf(t, db))

			backup, err := usersRebuild{now: rebuildClock}.run(db)

			if err != nil || backup != "" {
				t.Fatalf("run = %q, %v; want a no-op", backup, err)
			}
			if fmt.Sprint(schemaOf(t, db)) != before || len(backupsOf(t, path)) != 0 {
				t.Fatal("a no-op changed something")
			}
		})
	}
}

func TestRewriteUsersDDL(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{
			"CREATE TABLE `users` (`id` text,`name` text UNIQUE,`email` text UNIQUE,PRIMARY KEY (`id`))",
			"CREATE TABLE \"users_new\" (`id` text,`name` text ,`email` text ,PRIMARY KEY (`id`))",
		},
		{
			"CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, UNIQUE (`name`), UNIQUE (email COLLATE NOCASE ASC) ON CONFLICT IGNORE)",
			"CREATE TABLE \"users_new\" (id INTEGER PRIMARY KEY, name TEXT, email TEXT)",
		},
		{
			"CREATE TABLE IF NOT EXISTS main.\"users\" (\"id\" text, \"Email\" text CONSTRAINT \"uq, email\" UNIQUE ON CONFLICT ABORT NOT NULL, CONSTRAINT `uni_users_name` UNIQUE ([NAME]), CONSTRAINT both UNIQUE (email, name)) WITHOUT ROWID",
			"CREATE TABLE \"users_new\" (\"id\" text, \"Email\" text  NOT NULL, CONSTRAINT both UNIQUE (email, name)) WITHOUT ROWID",
		},
		{
			// UNIQUE on another column, in a string or in a CHECK stays.
			"CREATE TABLE users (id TEXT, clerk_user_id TEXT UNIQUE, name TEXT DEFAULT 'unique' CHECK (name != 'UNIQUE'), email TEXT)",
			"CREATE TABLE \"users_new\" (id TEXT, clerk_user_id TEXT UNIQUE, name TEXT DEFAULT 'unique' CHECK (name != 'UNIQUE'), email TEXT)",
		},
	} {
		got, err := rewriteUsersDDL(tc.in, "users_new")
		if err != nil || got != tc.want {
			t.Errorf("rewrite(%s)\n got %q, %v\nwant %q", tc.in, got, err, tc.want)
		}
	}
}

func TestRewriteUsersDDL_RefusesWhatItCannotRead(t *testing.T) {
	for _, in := range []string{
		"CREATE TABLE users AS SELECT 1 AS id",
		"CREATE TABLE users (id TEXT, email TEXT UNIQUE ON SOMETHING)",
		"CREATE TABLE users (id TEXT, email TEXT, UNIQUE (email) WHERE 1)",
		"CREATE TABLE users (id TEXT, email TEXT",
		"CREATE INDEX users ON x(y)",
	} {
		if got, err := rewriteUsersDDL(in, "users_new"); err == nil {
			t.Errorf("rewrite(%s) = %q, want an error", in, got)
		}
	}
}

// usersValues is every users row, original columns only: AutoMigrate adds
// the model's missing columns afterwards.
func usersValues(t *testing.T, db *gorm.DB, cols []columnInfo) string {
	t.Helper()
	names := make([]string, len(cols))
	for i, c := range cols {
		names[i] = fmt.Sprintf("quote(%s) AS %s", quoteIdent(c.Name), quoteIdent(c.Name))
	}
	var rows []map[string]any
	if err := db.Raw(fmt.Sprintf("SELECT %s FROM users ORDER BY rowid", strings.Join(names, ","))).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return fmt.Sprint(rows)
}

func closeDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	_ = sqlDB.Close()
}

// The startup sequence: the rebuild runs before AutoMigrate, which then
// creates every later model's table without putting the uniqueness back.
// The fixtures are the forms GORM and schema.sql produced, next to the real
// tables that hold a user's credits, lookups and trial.
func TestInit_RebuildsUsersThenAutoMigrates(t *testing.T) {
	prev := DB
	t.Cleanup(func() { DB = prev })
	for _, fx := range usersFixtures[:4] {
		t.Run(fx.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "enx.db")
			db := openFixture(t, path, "")
			execAll(t, db, fx.ddl...)
			if err := db.AutoMigrate(&CreditAccount{}, &CreditTransaction{}, &LookupEvent{}, &TrialGrant{}); err != nil {
				t.Fatal(err)
			}
			for _, id := range seedUsers(t, db) {
				uid := fmt.Sprint(id)
				for _, row := range []any{
					&CreditAccount{UserId: uid, TopupBalance: 700, UpdatedAt: 1},
					&CreditTransaction{Id: "txn-" + uid, UserId: uid, Type: "GRANT_TRIAL", Amount: 700, BalanceAfter: 700, CreatedAt: 2},
					&LookupEvent{UserID: uid, At: 3, Outcome: "allowed"},
					&TrialGrant{EmailHmac: "hmac-" + uid, UserId: uid, GrantedAt: 4},
				} {
					if err := db.Create(row).Error; err != nil {
						t.Fatal(err)
					}
				}
			}
			cols, err := tableColumns(db, "users")
			if err != nil {
				t.Fatal(err)
			}
			referencing := []string{"credit_accounts", "credit_transactions", "lookup_events", "trial_grants"}
			dump := func(db *gorm.DB) string {
				var b strings.Builder
				b.WriteString(usersValues(t, db, cols))
				for _, table := range referencing {
					b.WriteString("\n" + table + ": " + dumpRows(t, db, table))
				}
				return b.String()
			}
			before := dump(db)
			closeDB(t, db)

			for run := 1; run <= 2; run++ {
				if err := InitWithLogLevel(path, "warn"); err != nil {
					t.Fatalf("Init run %d: %v", run, err)
				}
				for _, table := range []string{"subscriptions", "referral_codes", "user_preferences", "saved_pages"} {
					if !DB.Migrator().HasTable(table) {
						t.Fatalf("run %d: AutoMigrate did not create %s", run, table)
					}
				}
				if !DB.Migrator().HasColumn("users", "avatar_url") {
					t.Fatalf("run %d: users has no avatar_url", run)
				}
				if got := profileUniqueness(t, DB); len(got) != 0 {
					t.Fatalf("run %d: still unique on %v: %s", run, got, usersDDLOf(t, DB))
				}
				if got := dump(DB); got != before {
					t.Fatalf("run %d: data changed:\n%s\nwant\n%s", run, got, before)
				}
				if err := copyFirstUser(t, DB, 90+run, "user_clerk1"); err == nil {
					t.Fatalf("run %d: a duplicate clerk_user_id went in", run)
				}
				if b := backupsOf(t, path); len(b) != 1 {
					t.Fatalf("run %d: backups = %v, want exactly one", run, b)
				}
				closeDB(t, DB)
			}
		})
	}
}

func TestInit_FailedRebuildStopsBeforeAutoMigrate(t *testing.T) {
	prev := DB
	t.Cleanup(func() { DB = prev })
	path := filepath.Join(t.TempDir(), "enx.db")
	db := openFixture(t, path, "")
	execAll(t, db,
		"CREATE TABLE users (id TEXT PRIMARY KEY, clerk_user_id TEXT, name TEXT UNIQUE, email TEXT, status TEXT)",
		"CREATE UNIQUE INDEX idx_users_email_live ON users(email) WHERE status = 'active'",
	)
	closeDB(t, db)

	err := InitWithLogLevel(path, "warn")

	if err == nil || !strings.Contains(err.Error(), "cannot classify") {
		t.Fatalf("Init = %v, want the rebuild's refusal", err)
	}
	check := openFixture(t, path, "")
	var tables int64
	if err := check.Raw("SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name != 'users'").Scan(&tables).Error; err != nil {
		t.Fatal(err)
	}
	if tables != 0 {
		t.Fatalf("%d tables created after the failure, want AutoMigrate not to have run", tables)
	}
}

func TestInit_ReturnsOpenErrors(t *testing.T) {
	prev := DB
	t.Cleanup(func() { DB = prev })
	file := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(file, nil, 0o644); err != nil {
		t.Fatal(err)
	}

	if err := InitWithLogLevel(filepath.Join(file, "enx.db"), "warn"); err == nil {
		t.Fatal("Init under a file succeeded, want an error")
	}
}

func TestInit_PanicsWhenInitialisationFails(t *testing.T) {
	prev := DB
	t.Cleanup(func() { DB = prev })
	file := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(file, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if recover() == nil {
			t.Fatal("Init did not panic")
		}
	}()
	Init(filepath.Join(file, "enx.db"))
}

// A new database has nothing to rebuild: no backup, and no uniqueness on
// email or name from the model.
func TestInit_NewDatabaseNeedsNoRebuild(t *testing.T) {
	prev := DB
	t.Cleanup(func() { DB = prev })
	path := filepath.Join(t.TempDir(), "enx.db")

	if err := InitWithLogLevel(path, "warn"); err != nil {
		t.Fatal(err)
	}

	if got := profileUniqueness(t, DB); len(got) != 0 {
		t.Fatalf("new users table is unique on %v", got)
	}
	if b := backupsOf(t, path); len(b) != 0 {
		t.Fatalf("backups = %v, want none", b)
	}
	if err := DB.Exec("INSERT INTO users (id, clerk_user_id, name, email) VALUES ('a', 'user_a', 'Same', 'same@example.com'), ('b', 'user_b', 'Same', 'same@example.com')").Error; err != nil {
		t.Fatalf("duplicate email and name: %v", err)
	}
	if err := DB.Exec("INSERT INTO users (id, clerk_user_id) VALUES ('c', 'user_a')").Error; err == nil {
		t.Fatal("a duplicate clerk_user_id went in")
	}
}
