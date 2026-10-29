package sqlitex

import (
	"time"

	"gorm.io/gorm"
)

const DeletionAttemptsVersion = "532-deletion-attempts-v1"

// MigrateDeletionAttempts adds recoverable ownership without changing the
// retained gate schema. No user data is copied; local users remain available
// until completion atomically deletes them and this recovery record.
func MigrateDeletionAttempts(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		done, err := migrationApplied(tx, DeletionAttemptsVersion)
		if err != nil || done {
			return err
		}
		if err := tx.Exec(`CREATE TABLE account_deletion_attempts (
   user_id text PRIMARY KEY NOT NULL,
   owner text NOT NULL,
   lease_until integer NOT NULL,
   phase text NOT NULL CHECK (phase IN ('checking', 'irreversible')),
   reset_trial integer NOT NULL CHECK (reset_trial IN (0, 1)))`).Error; err != nil {
			return err
		}
		return tx.Exec("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", DeletionAttemptsVersion, time.Now().UnixMilli()).Error
	})
}
