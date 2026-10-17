package repo

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"enx-api/adminuser"
	"enx-api/utils/sqlitex"
)

// AdminUsers is adminuser.Store over users, subscriptions, credit_accounts,
// credit_transactions and lookup_events (ADR-049 Decision 11-12). Now is the
// clock the balance sort uses to drop expired trials.
type AdminUsers struct {
	Now func() time.Time
}

var _ adminuser.Store = AdminUsers{}

// accountRow is one users row joined with its subscription and credit
// account; both may be missing.
type accountRow struct {
	ID                  string
	Email               string
	Name                string
	CreatedAt           time.Time
	LastLoginTime       time.Time
	Plan                sql.NullString
	Status              sql.NullString
	StripeCustomerID    sql.NullString
	SubscriptionBalance sql.NullInt64
	TopupBalance        sql.NullInt64
	TrialBalance        sql.NullInt64
	TrialExpiresAt      sql.NullInt64 // Unix seconds
}

func (r accountRow) account() adminuser.Account {
	a := adminuser.Account{
		UserID:              r.ID,
		Email:               r.Email,
		Name:                r.Name,
		CreatedAt:           r.CreatedAt,
		LastLoginAt:         r.LastLoginTime,
		Plan:                r.Plan.String,
		SubscriptionStatus:  r.Status.String,
		StripeCustomerID:    r.StripeCustomerID.String,
		SubscriptionBalance: r.SubscriptionBalance.Int64,
		TopupBalance:        r.TopupBalance.Int64,
		TrialBalance:        r.TrialBalance.Int64,
	}
	if r.TrialExpiresAt.Valid {
		at := time.Unix(r.TrialExpiresAt.Int64, 0)
		a.TrialExpiresAt = &at
	}
	return a
}

const accountColumns = `u.id, u.email, u.name, u.created_at, u.last_login_time,
	s.plan, s.status, s.stripe_customer_id,
	a.subscription_balance, a.topup_balance, a.trial_balance, a.trial_expires_at`

const accountJoins = `FROM users u
	LEFT JOIN subscriptions s ON s.user_id = u.id
	LEFT JOIN credit_accounts a ON a.user_id = u.id`

// clerkUsersU is clerkUsers on the u alias.
const clerkUsersU = "u.clerk_user_id IS NOT NULL AND u.clerk_user_id != ''"

func (s AdminUsers) ListAccounts(ctx context.Context, q adminuser.ListQuery) ([]adminuser.Account, int64, error) {
	where := clerkUsersU
	var args []any
	if q.Email != "" {
		where += ` AND u.email LIKE ? ESCAPE '\'`
		args = append(args, "%"+escapeLike(q.Email)+"%")
	}

	var total int64
	if err := sqlitex.DB.WithContext(ctx).Raw("SELECT COUNT(*) FROM users u WHERE "+where, args...).Scan(&total).Error; err != nil {
		return nil, 0, err
	}

	order := "datetime(u.created_at) DESC, u.id"
	switch q.Sort {
	case adminuser.SortLastLogin:
		order = "datetime(u.last_login_time) DESC, u.id"
	case adminuser.SortBalance:
		// The same balance the page shows: both pools plus a trial that
		// has not expired, never below zero (ADR-048).
		order = `COALESCE(a.subscription_balance, 0) + COALESCE(a.topup_balance, 0) +
			CASE WHEN a.trial_expires_at > ? AND a.trial_balance > 0 THEN a.trial_balance ELSE 0 END DESC, u.id`
		args = append(args, s.Now().Unix())
	}
	args = append(args, q.Limit, q.Offset)

	var rows []accountRow
	err := sqlitex.DB.WithContext(ctx).
		Raw("SELECT "+accountColumns+" "+accountJoins+" WHERE "+where+" ORDER BY "+order+" LIMIT ? OFFSET ?", args...).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	accounts := make([]adminuser.Account, len(rows))
	for i, r := range rows {
		accounts[i] = r.account()
	}
	return accounts, total, nil
}

func (AdminUsers) Account(ctx context.Context, userID string) (adminuser.Account, bool, error) {
	var rows []accountRow
	err := sqlitex.DB.WithContext(ctx).
		Raw("SELECT "+accountColumns+" "+accountJoins+" WHERE "+clerkUsersU+" AND u.id = ?", userID).
		Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return adminuser.Account{}, false, err
	}
	return rows[0].account(), true, nil
}

func (AdminUsers) LedgerSums(ctx context.Context, userIDs []string) (map[string]map[string]adminuser.LedgerSum, error) {
	out := make(map[string]map[string]adminuser.LedgerSum, len(userIDs))
	if len(userIDs) == 0 {
		return out, nil
	}
	var rows []struct {
		UserID string
		Type   string
		Sum    int64
		Count  int64
	}
	err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.CreditTransaction{}).
		Select("user_id, type, SUM(amount) AS sum, COUNT(*) AS count").
		Where("user_id IN ?", userIDs).
		Group("user_id, type").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if out[r.UserID] == nil {
			out[r.UserID] = map[string]adminuser.LedgerSum{}
		}
		out[r.UserID][r.Type] = adminuser.LedgerSum{Sum: r.Sum, Count: r.Count}
	}
	return out, nil
}

func (AdminUsers) DailyLookups(ctx context.Context, userID string, from, to time.Time) (map[string]int64, error) {
	var rows []struct {
		Day   string
		Count int64
	}
	err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.LookupEvent{}).
		Select("date(at / 1000, 'unixepoch') AS day, COUNT(*) AS count").
		Where("user_id = ? AND at >= ? AND at < ?", userID, from.UnixMilli(), to.UnixMilli()).
		Group("day").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[string]int64, len(rows))
	for _, r := range rows {
		out[r.Day] = r.Count
	}
	return out, nil
}

func (AdminUsers) AISpend(ctx context.Context, userID string, from, to time.Time) (map[string]int64, error) {
	var rows []struct {
		Feature string
		Credits int64
	}
	err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.CreditTransaction{}).
		Select("feature, -SUM(amount) AS credits").
		Where("user_id = ? AND type IN ? AND created_at >= ? AND created_at < ?",
			userID, []string{"CONSUME", "SETTLE", "REFUND"}, from.UnixMilli(), to.UnixMilli()).
		Group("feature").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[string]int64, len(rows))
	for _, r := range rows {
		out[r.Feature] = r.Credits
	}
	return out, nil
}

func (AdminUsers) Transactions(ctx context.Context, userID string, before *adminuser.Cursor, limit int) ([]adminuser.Transaction, error) {
	query := sqlitex.DB.WithContext(ctx).Model(&sqlitex.CreditTransaction{}).
		Select("rowid AS seq, id, user_id, type, amount, balance_after, feature, note, created_at").
		Where("user_id = ?", userID)
	if before != nil {
		ms := before.CreatedAt.UnixMilli()
		query = query.Where("created_at < ? OR (created_at = ? AND rowid < ?)", ms, ms, before.Seq)
	}
	var rows []struct {
		Seq          int64
		ID           string
		UserID       string
		Type         string
		Amount       int64
		BalanceAfter int64
		Feature      string
		Note         string
		CreatedAt    int64 // Unix ms
	}
	if err := query.Order("created_at DESC, rowid DESC").Limit(limit).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]adminuser.Transaction, len(rows))
	for i, r := range rows {
		out[i] = adminuser.Transaction{
			ID: r.ID, Seq: r.Seq, UserID: r.UserID, Type: r.Type, Amount: r.Amount,
			BalanceAfter: r.BalanceAfter, Feature: r.Feature, Note: r.Note,
			CreatedAt: time.UnixMilli(r.CreatedAt),
		}
	}
	return out, nil
}

// escapeLike makes s match literally inside a LIKE pattern with ESCAPE '\'.
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}
