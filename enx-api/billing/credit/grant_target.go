package credit

import (
	"errors"

	"gorm.io/gorm"
)

// ErrDeletionInProgress is retryable: no grant may pass until deletion has
// durably completed or safely released its gate.
var ErrDeletionInProgress = errors.New("credit: account deletion in progress")

// checkGrantTarget checks user existence and deletion state in the ledger transaction.
func checkGrantTarget(tx *gorm.DB, userID string) error {
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
