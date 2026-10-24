package repo

import (
	"context"
	"errors"
	"time"

	"enx-api/account"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Accounts is account.Users over users and every table keyed by a user id
// (ADR-062 Decision 1).
type Accounts struct{}

var _ account.Users = Accounts{}

func (Accounts) Get(ctx context.Context, userID string) (account.User, bool, error) {
	var u sqlitex.User
	err := sqlitex.DB.WithContext(ctx).Where("id = ?", userID).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return account.User{}, false, nil
	}
	if err != nil {
		return account.User{}, false, err
	}
	return account.User{ID: u.Id, ClerkUserID: u.ClerkUserID, Email: u.Email, Status: account.Status(u.Status)}, true, nil
}

func (Accounts) SetStatus(ctx context.Context, userID string, status account.Status) error {
	return sqlitex.DB.WithContext(ctx).Model(&sqlitex.User{}).Where("id = ?", userID).
		Updates(map[string]any{"status": string(status), "updated_at": time.Now()}).Error
}

// personalTables are the tables whose rows a deletion removes, each with its
// user id column. Kept on purpose: credit_transactions, subscriptions and
// referrals (the ledger), trial_grants (the email HMAC),
// account_deletion_gates (ADR-067's retained deletion gate), and
// active_users_daily (counts, no user ids).
var personalTables = []struct{ table, column string }{
	{"user_dicts", "user_id"},
	{"lookup_events", "user_id"},
	{"daily_stats", "user_id"},
	{"stats_ingest_log", "user_id"},
	{"saved_pages", "user_id"},
	{"user_preferences", "user_id"},
	{"reader_documents", "user_id"},
	{"page_reports", "user_id"},
	{"referral_codes", "user_id"},
	{"sessions", "user_id"},
	// The balances: whatever was left is forfeited with the account.
	{"credit_accounts", "user_id"},
	{"users", "id"},
}

func (Accounts) DeleteData(ctx context.Context, userID string) error {
	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, t := range personalTables {
			if err := tx.Exec("DELETE FROM "+t.table+" WHERE "+t.column+" = ?", userID).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// TrialGrants is account.TrialGrants over trial_grants (ADR-062 Decision 3).
// Hash is the email HMAC, for the lookups that start from a user id.
type TrialGrants struct {
	Hash func(email string) string
}

var _ account.TrialGrants = TrialGrants{}

func (TrialGrants) Record(ctx context.Context, emailHMAC, userID string, at time.Time) error {
	return sqlitex.DB.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).
		Create(&sqlitex.TrialGrant{EmailHmac: emailHMAC, UserId: userID, GrantedAt: at.UnixMilli()}).Error
}

func (TrialGrants) Delete(ctx context.Context, emailHMAC string) error {
	return sqlitex.DB.WithContext(ctx).Where("email_hmac = ?", emailHMAC).Delete(&sqlitex.TrialGrant{}).Error
}

// EmailHMACOf is the HMAC of userID's email; "" when the user has none or no
// key is configured.
func (g TrialGrants) EmailHMACOf(ctx context.Context, userID string) (string, error) {
	var u sqlitex.User
	err := sqlitex.DB.WithContext(ctx).Select("email").Where("id = ?", userID).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return g.Hash(u.Email), nil
}

// TrialUsedByAnotherAccount reports whether userID's email was granted a
// trial by a different account, one since deleted (ADR-062 Decision 3). An
// email that cannot be hashed counts as used: the rule fails closed.
func (g TrialGrants) TrialUsedByAnotherAccount(ctx context.Context, userID string) (bool, error) {
	h, err := g.EmailHMACOf(ctx, userID)
	if err != nil {
		return false, err
	}
	if h == "" {
		return true, nil
	}
	var n int64
	err = sqlitex.DB.WithContext(ctx).Model(&sqlitex.TrialGrant{}).
		Where("email_hmac = ? AND user_id != ?", h, userID).Count(&n).Error
	return n > 0, err
}

// Backfill writes a record for every user with an email (ADR-062 Decision
// 3's migration), so an account from before trial_grants existed cannot be
// deleted and re-registered for a second trial. A record already there is
// kept. Safe to rerun; it returns how many records it added.
func (g TrialGrants) Backfill(ctx context.Context, at time.Time) (int, error) {
	var users []sqlitex.User
	if err := sqlitex.DB.WithContext(ctx).Select("id", "email").
		Where("email IS NOT NULL AND email != ''").Order("created_at, id").Find(&users).Error; err != nil {
		return 0, err
	}
	added := 0
	for _, u := range users {
		h := g.Hash(u.Email)
		if h == "" {
			continue
		}
		res := sqlitex.DB.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).
			Create(&sqlitex.TrialGrant{EmailHmac: h, UserId: u.Id, GrantedAt: at.UnixMilli()})
		if res.Error != nil {
			return added, res.Error
		}
		added += int(res.RowsAffected)
	}
	return added, nil
}
