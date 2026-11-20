package sqlitex

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// ensurePre1027UsersSubject rewrites users to the pre-#1027 column and index
// names when Init already created auth_subject, so InitWithLogLevel can be
// asked to migrate it. A database that still has clerk_user_id is left as is.
func ensurePre1027UsersSubject(t *testing.T, path string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = raw.Close() }()
	hasOld := db.Migrator().HasColumn("users", "clerk_user_id")
	hasNew := db.Migrator().HasColumn("users", "auth_subject")
	switch {
	case hasOld && !hasNew:
		return
	case !hasOld && hasNew:
		execOnFile(t, path,
			`DROP INDEX IF EXISTS idx_users_auth_subject`,
			`ALTER TABLE users RENAME COLUMN auth_subject TO clerk_user_id`,
			`CREATE UNIQUE INDEX idx_users_clerk_user_id ON users(clerk_user_id)`,
		)
	default:
		t.Fatalf("users subject columns: clerk_user_id=%v auth_subject=%v", hasOld, hasNew)
	}
}

func subjectIndexNames(t *testing.T, db *gorm.DB) []string {
	t.Helper()
	var names []string
	rows, err := db.Raw(`SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'users' AND sql LIKE '%auth_subject%'`).Rows()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	return names
}

func TestInitWithLogLevel_RenamesClerkUserIDToAuthSubject(t *testing.T) {
	path := initializedDatabase(t)
	ensurePre1027UsersSubject(t, path)
	execOnFile(t, path,
		`INSERT INTO users (id, clerk_user_id, email, name, status) VALUES ('u1', 'sub_alice', 'a@example.com', 'Alice', 'active')`,
		`INSERT INTO users (id, clerk_user_id, email, name, status) VALUES ('u2', 'sub_bob', 'b@example.com', 'Bob', 'active')`,
		`INSERT INTO users (id, clerk_user_id, email, name, status) VALUES ('u3', NULL, 'c@example.com', 'Carol', 'active')`,
		`INSERT INTO credit_accounts (user_id, subscription_balance, topup_balance, updated_at) VALUES ('u1', 10, 0, 1)`,
		`INSERT INTO credit_accounts (user_id, subscription_balance, topup_balance, updated_at) VALUES ('u2', 20, 5, 1)`,
	)

	previous := DB
	t.Cleanup(func() { DB = previous })
	if err := InitWithLogLevel(path, "error"); err != nil {
		t.Fatalf("InitWithLogLevel: %v", err)
	}
	t.Cleanup(func() {
		if raw, err := DB.DB(); err == nil {
			_ = raw.Close()
		}
	})

	if DB.Migrator().HasColumn("users", "clerk_user_id") {
		t.Fatal("clerk_user_id still present after migration")
	}
	if !DB.Migrator().HasColumn("users", "auth_subject") {
		t.Fatal("auth_subject missing after migration")
	}
	indexes := subjectIndexNames(t, DB)
	if len(indexes) != 1 || indexes[0] != "idx_users_auth_subject" {
		t.Fatalf("subject indexes = %v, want [idx_users_auth_subject]", indexes)
	}
	if DB.Migrator().HasIndex("users", "idx_users_clerk_user_id") {
		t.Fatal("idx_users_clerk_user_id still present")
	}

	var rows []struct {
		ID          string
		AuthSubject *string
		Balance     int64
	}
	if err := DB.Raw(`
		SELECT u.id AS id, u.auth_subject AS auth_subject, c.subscription_balance AS balance
		FROM users u LEFT JOIN credit_accounts c ON c.user_id = u.id
		WHERE u.id IN ('u1', 'u2', 'u3') ORDER BY u.id`).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("rows = %d, want 3", len(rows))
	}
	want := map[string]struct {
		sub     *string
		balance int64
	}{
		"u1": {ptr("sub_alice"), 10},
		"u2": {ptr("sub_bob"), 20},
		"u3": {nil, 0},
	}
	for _, row := range rows {
		w := want[row.ID]
		if (row.AuthSubject == nil) != (w.sub == nil) || (row.AuthSubject != nil && *row.AuthSubject != *w.sub) {
			t.Errorf("%s subject = %v, want %v", row.ID, row.AuthSubject, w.sub)
		}
		if row.Balance != w.balance {
			t.Errorf("%s balance = %d, want %d", row.ID, row.Balance, w.balance)
		}
	}

	if err := DB.Exec(`INSERT INTO users (id, auth_subject) VALUES ('u4', 'sub_alice')`).Error; err == nil {
		t.Fatal("duplicate auth_subject was accepted")
	}

	before, err := dumpUsersSubjects(t, DB)
	if err != nil {
		t.Fatal(err)
	}
	if raw, err := DB.DB(); err == nil {
		_ = raw.Close()
	}
	if err := InitWithLogLevel(path, "error"); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	after, err := dumpUsersSubjects(t, DB)
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatalf("reopen changed users: before=%s after=%s", before, after)
	}
	if DB.Migrator().HasColumn("users", "clerk_user_id") {
		t.Fatal("reopen reintroduced clerk_user_id")
	}
	indexes = subjectIndexNames(t, DB)
	if len(indexes) != 1 || indexes[0] != "idx_users_auth_subject" {
		t.Fatalf("reopen subject indexes = %v, want [idx_users_auth_subject]", indexes)
	}
}

func TestInitWithLogLevel_FreshDatabaseCreatesAuthSubject(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fresh.db")
	previous := DB
	t.Cleanup(func() { DB = previous })
	if err := InitWithLogLevel(path, "error"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if raw, err := DB.DB(); err == nil {
			_ = raw.Close()
		}
	})
	if !DB.Migrator().HasColumn("users", "auth_subject") {
		t.Fatal("fresh users table has no auth_subject")
	}
	if DB.Migrator().HasColumn("users", "clerk_user_id") {
		t.Fatal("fresh users table still has clerk_user_id")
	}
	indexes := subjectIndexNames(t, DB)
	if len(indexes) != 1 || indexes[0] != "idx_users_auth_subject" {
		t.Fatalf("fresh subject indexes = %v, want [idx_users_auth_subject]", indexes)
	}
}

func TestInitWithLogLevel_AmbiguousSubjectColumnsRefuseStartup(t *testing.T) {
	path := initializedDatabase(t)
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	hasNew := db.Migrator().HasColumn("users", "auth_subject")
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	_ = raw.Close()
	if hasNew {
		execOnFile(t, path, `ALTER TABLE users ADD COLUMN clerk_user_id TEXT`)
	} else {
		execOnFile(t, path, `ALTER TABLE users ADD COLUMN auth_subject TEXT`)
	}

	previous := DB
	t.Cleanup(func() { DB = previous })
	err = InitWithLogLevel(path, "error")
	if err == nil || !strings.Contains(err.Error(), "both clerk_user_id and auth_subject") {
		t.Fatalf("InitWithLogLevel = %v, want ambiguous-column refusal", err)
	}
}

func TestInitWithLogLevel_FailedRenameRefusesStartupAndKeepsOldColumn(t *testing.T) {
	for _, failAt := range []string{stepAuthSubjectColumnRenamed, stepAuthSubjectIndexReplaced} {
		t.Run(failAt, func(t *testing.T) {
			path := initializedDatabase(t)
			ensurePre1027UsersSubject(t, path)
			execOnFile(t, path,
				`INSERT INTO users (id, clerk_user_id, email, name, status) VALUES ('u1', 'sub_a', 'a@example.com', 'A', 'active')`,
				`INSERT INTO users (id, clerk_user_id, email, name, status) VALUES ('u2', NULL, 'b@example.com', 'B', 'active')`,
			)

			previousMigrate := migrateAuthSubject
			t.Cleanup(func() { migrateAuthSubject = previousMigrate })
			migrateAuthSubject = func(db *gorm.DB) error {
				return authSubjectRename{afterStep: func(step string, _ *gorm.DB) error {
					if step == failAt {
						return errors.New("disk full")
					}
					return nil
				}}.run(db)
			}
			previous := DB
			t.Cleanup(func() { DB = previous })

			err := InitWithLogLevel(path, "error")
			if err == nil || !strings.Contains(err.Error(), "disk full") {
				t.Fatalf("InitWithLogLevel = %v, want disk full", err)
			}
			if raw, rerr := DB.DB(); rerr == nil {
				_ = raw.Close()
			}

			db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if raw, err := db.DB(); err == nil {
					_ = raw.Close()
				}
			})
			if !db.Migrator().HasColumn("users", "clerk_user_id") {
				t.Fatal("failed rename dropped clerk_user_id")
			}
			if db.Migrator().HasColumn("users", "auth_subject") {
				t.Fatal("failed rename left auth_subject (or AutoMigrate ran)")
			}
			if !db.Migrator().HasIndex("users", "idx_users_clerk_user_id") {
				t.Fatal("idx_users_clerk_user_id lost after rollback")
			}
			if db.Migrator().HasIndex("users", "idx_users_auth_subject") {
				t.Fatal("idx_users_auth_subject present after rollback")
			}
			var got []string
			if err := db.Raw(`SELECT coalesce(clerk_user_id, '<null>') FROM users WHERE id IN ('u1','u2') ORDER BY id`).Scan(&got).Error; err != nil {
				t.Fatal(err)
			}
			if len(got) != 2 || got[0] != "sub_a" || got[1] != "<null>" {
				t.Fatalf("values after failed rename = %v", got)
			}
		})
	}
}

func TestLegacyBillingFixtureStillUsesClerkUserID(t *testing.T) {
	stmts := legacyStatements(t, "schema.sql")
	joined := strings.Join(stmts, ";")
	if !strings.Contains(joined, "clerk_user_id") {
		t.Fatal("legacy billing schema lost clerk_user_id")
	}
	if strings.Contains(joined, "auth_subject") {
		t.Fatal("legacy billing schema must not use auth_subject")
	}
	path := filepath.Join(t.TempDir(), "legacy.db")
	execOnFile(t, path, stmts...)
	assertStartupRefusesUnchanged(t, path)
}

func dumpUsersSubjects(t *testing.T, db *gorm.DB) (string, error) {
	t.Helper()
	var parts []string
	rows, err := db.Raw(`SELECT id || '=' || coalesce(auth_subject, '<null>') FROM users WHERE id IN ('u1','u2','u3') ORDER BY id`).Rows()
	if err != nil {
		return "", err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return "", err
		}
		parts = append(parts, s)
	}
	return strings.Join(parts, ","), nil
}

func ptr(s string) *string { return &s }
