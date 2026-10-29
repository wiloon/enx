package credit

import (
	"enx-api/utils/sqlitex"
	"errors"

	"gorm.io/gorm"
)

// ErrDeletionInProgress is retryable: no grant may pass until deletion has
// durably completed or safely released its gate.
var ErrDeletionInProgress = errors.New("credit: account deletion in progress")

// checkGrantTarget runs in the balance/ledger transaction. The cutover schema
// exists only behind BILLING_CUTOVER; startup rejects running legacy billing
// against a migrated database. Schema detection also keeps standalone ledger
// callers on the same policy without process-global configuration.
func checkGrantTarget(tx *gorm.DB, userID string) error {
	cutover, err := cutoverLedger(tx)
	if err != nil || !cutover {
		return err
	}
	// Take SQLite's write lock before reading the gate or existence. Deletion
	// uses the same writer serialization; a stale read upgrade fails closed.
	res := tx.Exec("UPDATE users SET billing_version = billing_version WHERE id = ?", userID)
	if res.Error != nil {
		return res.Error
	}
	var states []string
	if err := tx.Raw("SELECT state FROM account_deletion_gates WHERE user_id = ?", userID).Scan(&states).Error; err != nil {
		return err
	}
	if len(states) > 0 && states[0] == "deleted" {
		return ErrNoUser
	}
	if res.RowsAffected == 0 {
		return ErrNoUser
	}
	if len(states) > 0 {
		return ErrDeletionInProgress
	}
	return nil
}

// The persisted marker is also present when a damaged gate table cannot be
// read, so a failed gate read cannot accidentally select legacy grants.
func cutoverLedger(tx *gorm.DB) (bool, error) {
	var tables int64
	if err := tx.Raw("SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'").Scan(&tables).Error; err != nil {
		return false, err
	}
	if tables == 0 {
		return false, nil
	}
	var migrated int64
	err := tx.Raw("SELECT count(*) FROM schema_migrations WHERE version = ?", sqlitex.DeletionGatesVersion).Scan(&migrated).Error
	return migrated > 0, err
}
