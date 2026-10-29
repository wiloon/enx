package repo

import (
	"context"
	"time"

	"enx-api/account"
	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AccountDeletions coordinates both deletion routes with the same SQLite
// write serialization and billing_version used by entitlement writers.
type AccountDeletions struct{}

func (AccountDeletions) Acquire(ctx context.Context, u account.User, opts account.DeleteOptions, now time.Time) (account.DeletionAttempt, error) {
	a := account.DeletionAttempt{UserID: u.ID, Owner: uuid.NewString()}
	err := sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// First statement is a write: SQLite serializes us before reading any
		// eligibility or ownership data (no deferred read-to-write upgrade).
		if err := tx.Exec(`INSERT INTO account_deletion_gates (user_id, state, started_at, updated_at)
   SELECT id, 'in_progress', ?, ? FROM users WHERE id = ?
   ON CONFLICT(user_id) DO NOTHING`, now.UnixMilli(), now.UnixMilli(), u.ID).Error; err != nil {
			return err
		}
		var states []string
		if err := tx.Raw("SELECT state FROM account_deletion_gates WHERE user_id = ?", u.ID).Scan(&states).Error; err != nil {
			return err
		}
		if len(states) != 1 || states[0] != "in_progress" {
			return account.ErrUserNotFound
		}
		res := tx.Exec(`INSERT INTO account_deletion_attempts (user_id, owner, lease_until, phase, reset_trial)
   VALUES (?, ?, ?, 'checking', ?)
   ON CONFLICT(user_id) DO UPDATE SET owner = excluded.owner, lease_until = excluded.lease_until
   WHERE account_deletion_attempts.lease_until <= ?`, u.ID, a.Owner, now.Add(time.Minute).UnixMilli(), opts.ResetTrial, now.UnixMilli())
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return account.ErrDeletionInProgress
		}
		res = tx.Exec("UPDATE users SET billing_version = billing_version + 1 WHERE id = ?", u.ID)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return account.ErrUserNotFound
		}
		var err error
		a.Revision, _, err = billingRevision(tx, u.ID)
		if err != nil {
			return err
		}
		var phases []string
		if err := tx.Raw("SELECT phase FROM account_deletion_attempts WHERE user_id = ?", u.ID).Scan(&phases).Error; err != nil {
			return err
		}
		a.Irreversible = phases[0] == "irreversible"
		return nil
	})
	return a, err
}

func (AccountDeletions) Prepare(ctx context.Context, a account.DeletionAttempt, emailHMAC string, now time.Time) error {
	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Exec(`UPDATE account_deletion_attempts SET phase = 'irreversible'
   WHERE user_id = ? AND owner = ? AND lease_until > ? AND phase = 'checking'
   AND EXISTS (SELECT 1 FROM users WHERE id = ? AND billing_version = ?)`, a.UserID, a.Owner, now.UnixMilli(), a.UserID, a.Revision)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return account.ErrDeletionInProgress
		}
		if emailHMAC == "" {
			return nil
		}
		var resets []bool
		if err := tx.Raw("SELECT reset_trial FROM account_deletion_attempts WHERE user_id = ?", a.UserID).Scan(&resets).Error; err != nil {
			return err
		}
		if resets[0] {
			return tx.Exec("DELETE FROM trial_grants WHERE email_hmac = ?", emailHMAC).Error
		}
		return tx.Exec("INSERT INTO trial_grants (email_hmac, user_id, granted_at) VALUES (?, ?, ?) ON CONFLICT(email_hmac) DO NOTHING", emailHMAC, a.UserID, now.UnixMilli()).Error
	})
}

func (AccountDeletions) Release(ctx context.Context, a account.DeletionAttempt, now time.Time) error {
	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Exec("DELETE FROM account_deletion_attempts WHERE user_id = ? AND owner = ? AND lease_until > ? AND phase = 'checking'", a.UserID, a.Owner, now.UnixMilli())
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return account.ErrDeletionInProgress
		}
		return tx.Exec("DELETE FROM account_deletion_gates WHERE user_id = ? AND state = 'in_progress'", a.UserID).Error
	})
}

func (AccountDeletions) Complete(ctx context.Context, a account.DeletionAttempt, now time.Time) error {
	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Exec("DELETE FROM account_deletion_attempts WHERE user_id = ? AND owner = ? AND lease_until > ? AND phase = 'irreversible'", a.UserID, a.Owner, now.UnixMilli())
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return account.ErrDeletionInProgress
		}
		for _, t := range personalTables {
			if err := tx.Exec("DELETE FROM "+t.table+" WHERE "+t.column+" = ?", a.UserID).Error; err != nil {
				return err
			}
		}
		return tx.Exec("UPDATE account_deletion_gates SET state = 'deleted', deleted_at = ?, updated_at = ? WHERE user_id = ?", now.UnixMilli(), now.UnixMilli(), a.UserID).Error
	})
}
