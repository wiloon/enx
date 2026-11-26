// Package adapters reads the funnel's data from the application database.
package adapters

import (
	"context"
	"time"

	"enx-api/funnel"
	"enx-api/stats"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// Repo implements funnel.Repository.
type Repo struct {
	DB *gorm.DB
}

// Accounts lists every account. The sign-up week is picked from the parsed
// times, not in SQL: created_at is stored as text with the writer's offset.
func (r Repo) Accounts(ctx context.Context) ([]funnel.Account, error) {
	var users []sqlitex.User
	if err := r.DB.WithContext(ctx).Select("id", "auth_subject", "created_at").Find(&users).Error; err != nil {
		return nil, err
	}
	accounts := make([]funnel.Account, len(users))
	for i, u := range users {
		accounts[i] = funnel.Account{ID: u.Id, AuthSubject: u.AuthSubject, SignedUpAt: u.CreatedAt}
	}
	return accounts, nil
}

// Activity reads what users did. A user's lookup days are the union of the
// rolled-up days in daily_stats and the days of the allowed events still
// kept, so a day in both is listed twice.
func (r Repo) Activity(ctx context.Context) (funnel.Activity, error) {
	db := r.DB.WithContext(ctx)
	var a funnel.Activity

	var days []struct {
		UserID string
		Day    string
	}
	if err := db.Raw(
		`SELECT user_id, date AS day FROM daily_stats WHERE word_lookups > 0
		 UNION ALL
		 SELECT DISTINCT user_id, ` + stats.LocalDayOfEvent + ` AS day FROM lookup_events WHERE outcome = 'allowed'`,
	).Scan(&days).Error; err != nil {
		return a, err
	}
	a.LookupDays = make(map[string][]string)
	for _, d := range days {
		a.LookupDays[d.UserID] = append(a.LookupDays[d.UserID], d.Day)
	}

	var err error
	// CONSUME is only on rows written before ADR-012; SETTLE since.
	if a.AICallers, err = usersWithLedgerRow(db, "SETTLE", "CONSUME"); err != nil {
		return a, err
	}
	if a.Payers, err = usersWithLedgerRow(db, "GRANT_SUBSCRIPTION", "GRANT_TOPUP"); err != nil {
		return a, err
	}

	var trials []sqlitex.CreditAccount
	if err := db.Where("trial_expires_at IS NOT NULL").Find(&trials).Error; err != nil {
		return a, err
	}
	a.Trials = make(map[string]funnel.Trial, len(trials))
	for _, t := range trials {
		a.Trials[t.UserId] = funnel.Trial{ExpiresAt: time.Unix(*t.TrialExpiresAt, 0), Balance: t.TrialBalance}
	}
	return a, nil
}

// usersWithLedgerRow is the users with a ledger row of any of the types.
func usersWithLedgerRow(db *gorm.DB, types ...string) (map[string]bool, error) {
	var ids []string
	if err := db.Model(&sqlitex.CreditTransaction{}).
		Distinct("user_id").Where("type IN ?", types).Pluck("user_id", &ids).Error; err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}
