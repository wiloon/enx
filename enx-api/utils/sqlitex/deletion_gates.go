package sqlitex

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

// ADR-067 §注销与财务留存: account deletion and concurrent subscription
// acceptance coordinate through a persisted deletion gate. It is raised
// before any external deletion work, and it outlives the hard deletion of
// the users row as the opaque local user ID and the terminal deleted state
// (no name, no email), so a delayed payment for a deleted user is told apart
// from one still waiting for attribution. The table is new and touches no
// existing data, so MigrateDeletionGates needs no preflight or backup; it
// still runs in one transaction and records its completion in
// schema_migrations.

// DeletionGatesVersion names the migration in schema_migrations.
const DeletionGatesVersion = "297-deletion-gates-v1"

// deletionGatesDDL is one gate per local user. No row means no deletion is
// under way; an aborted deletion removes its row. The gate is retained
// financial context: account deletion never removes it, and nothing
// cascades to it from users.
const deletionGatesDDL = "CREATE TABLE `account_deletion_gates` (" +
	"`user_id` text NOT NULL," +
	"`state` text NOT NULL CHECK (`state` IN ('in_progress', 'deleted'))," +
	"`started_at` integer NOT NULL," +
	"`deleted_at` integer," +
	"`updated_at` integer NOT NULL," +
	"PRIMARY KEY (`user_id`))"

// MigrateDeletionGates creates the deletion gate table. It returns false,
// changing nothing, once schema_migrations records it; any failure leaves
// the database as it was.
func MigrateDeletionGates(db *gorm.DB) (bool, error) {
	applied := false
	err := db.Connection(func(conn *gorm.DB) error {
		return conn.Transaction(func(tx *gorm.DB) error {
			done, err := migrationApplied(tx, DeletionGatesVersion)
			if err != nil || done {
				return err
			}
			if err := execEach(tx, schemaMigrationsDDL, deletionGatesDDL); err != nil {
				return err
			}
			if err := tx.Exec("INSERT INTO `schema_migrations` (`version`, `applied_at`) VALUES (?, ?)",
				DeletionGatesVersion, time.Now().UnixMilli()).Error; err != nil {
				return fmt.Errorf("record completion: %w", err)
			}
			applied = true
			return nil
		})
	})
	if err != nil {
		return false, fmt.Errorf("deletion gates migration: %w (nothing was changed)", err)
	}
	return applied, nil
}
