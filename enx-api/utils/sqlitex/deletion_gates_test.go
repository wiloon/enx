package sqlitex

import (
	"path/filepath"
	"testing"

	"gorm.io/gorm"
)

func deletionGateTables(t *testing.T, db *gorm.DB) []string {
	t.Helper()
	var names []string
	if err := db.Raw("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'account_deletion_gates'").Scan(&names).Error; err != nil {
		t.Fatalf("read tables: %v", err)
	}
	return names
}

func deletionGatesMarked(t *testing.T, db *gorm.DB) bool {
	t.Helper()
	done, err := migrationApplied(db, DeletionGatesVersion)
	if err != nil {
		t.Fatalf("read marker: %v", err)
	}
	return done
}

func TestDeletionGatesMigrationCreatesTheGateTableAndRecordsItself(t *testing.T) {
	db := openFixture(t, filepath.Join(t.TempDir(), "enx.db"), "")

	applied, err := MigrateDeletionGates(db)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if !applied {
		t.Fatal("applied = false, want the first run to apply the migration")
	}
	if got := deletionGateTables(t, db); len(got) != 1 {
		t.Fatalf("tables = %v, want account_deletion_gates", got)
	}
	if !deletionGatesMarked(t, db) {
		t.Fatalf("schema_migrations has no %s", DeletionGatesVersion)
	}
}

func TestDeletionGatesKeepOneGatePerLocalUserWithAKnownState(t *testing.T) {
	db := openFixture(t, filepath.Join(t.TempDir(), "enx.db"), "")
	if _, err := MigrateDeletionGates(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	execAll(t, db, "INSERT INTO `account_deletion_gates` (`user_id`, `state`, `started_at`, `updated_at`) VALUES ('user_1', 'in_progress', 1, 1)")

	if err := db.Exec("INSERT INTO `account_deletion_gates` (`user_id`, `state`, `started_at`, `updated_at`) VALUES ('user_1', 'deleted', 2, 2)").Error; err == nil {
		t.Error("a second gate for user_1 was stored, want one gate per local user")
	}
	if err := db.Exec("INSERT INTO `account_deletion_gates` (`user_id`, `state`, `started_at`, `updated_at`) VALUES ('user_2', 'paused', 1, 1)").Error; err == nil {
		t.Error("a gate in state paused was stored, want only in_progress or deleted")
	}
}

func TestDeletionGatesMigrationRunsOnlyOnce(t *testing.T) {
	db := openFixture(t, filepath.Join(t.TempDir(), "enx.db"), "")
	if _, err := MigrateDeletionGates(db); err != nil {
		t.Fatalf("first run: %v", err)
	}

	applied, err := MigrateDeletionGates(db)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if applied {
		t.Fatal("applied = true on the second run, want it to see the marker and do nothing")
	}
}

func TestAFailedDeletionGatesMigrationLeavesNothingBehind(t *testing.T) {
	db := openFixture(t, filepath.Join(t.TempDir(), "enx.db"), "")
	// A stray table of the same name makes the CREATE fail.
	execAll(t, db, "CREATE TABLE `account_deletion_gates` (`x` text)")

	if _, err := MigrateDeletionGates(db); err == nil {
		t.Fatal("migrate succeeded over a stray account_deletion_gates table, want an error")
	}
	if deletionGatesMarked(t, db) {
		t.Fatal("a failed migration recorded its marker")
	}
}
