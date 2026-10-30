package repo

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"enx-api/adminuser"
	"enx-api/billing/attribution"
	"enx-api/utils/sqlitex"
)

// AcceptedAdminUsers is adminuser.Store over the Subscription-ID-keyed schema
// (ADR-067): plan and status come from the user's accepted subscription, and
// the Customer is the one attribution.SelectCustomer picks from the stored
// rows, as the Portal does. It makes no Stripe call; ledger, lookup and
// transaction reads are shared with AdminUsers.
type AcceptedAdminUsers struct {
	AdminUsers
}

var _ adminuser.Store = AcceptedAdminUsers{}

// acceptedAccountRow is one users row joined with its accepted subscription,
// as scanned. The fields are not an embedded accountRow because GORM cannot
// set an embedded unexported struct.
type acceptedAccountRow struct {
	ID                  string
	Email               string
	Name                string
	UserStatus          string
	CreatedAt           time.Time
	LastLoginTime       time.Time
	Plan                sql.NullString
	Status              sql.NullString
	AcceptedID          sql.NullString
	AcceptedCustomerID  sql.NullString
	SubscriptionBalance sql.NullInt64
	TopupBalance        sql.NullInt64
	TrialBalance        sql.NullInt64
	TrialExpiresAt      sql.NullInt64 // Unix seconds
}

const acceptedAccountColumns = `u.id, u.email, u.name, u.status AS user_status, u.created_at, u.last_login_time,
	s.plan, s.status, u.accepted_subscription_id AS accepted_id, s.stripe_customer_id AS accepted_customer_id,
	a.subscription_balance, a.topup_balance, a.trial_balance, a.trial_expires_at`

// acceptedAccountJoins joins at most one subscription per user, so the list
// and its COUNT agree however many subscriptions the user owns.
const acceptedAccountJoins = `FROM users u
	LEFT JOIN subscriptions s ON s.stripe_subscription_id = u.accepted_subscription_id AND s.user_id = u.id
	LEFT JOIN credit_accounts a ON a.user_id = u.id`

func (s AcceptedAdminUsers) ListAccounts(ctx context.Context, q adminuser.ListQuery) ([]adminuser.Account, int64, error) {
	where := clerkUsersU
	var args []any
	if q.Query != "" {
		where += ` AND (u.email LIKE ? ESCAPE '\' OR u.id = ?)`
		args = append(args, "%"+escapeLike(q.Query)+"%", q.Query)
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
		order = `COALESCE(a.subscription_balance, 0) + COALESCE(a.topup_balance, 0) +
			CASE WHEN a.trial_expires_at > ? AND a.trial_balance > 0 THEN a.trial_balance ELSE 0 END DESC, u.id`
		args = append(args, s.Now().Unix())
	}
	args = append(args, q.Limit, q.Offset)

	var rows []acceptedAccountRow
	err := sqlitex.DB.WithContext(ctx).
		Raw("SELECT "+acceptedAccountColumns+" "+acceptedAccountJoins+" WHERE "+where+" ORDER BY "+order+" LIMIT ? OFFSET ?", args...).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	accounts, err := withSelectedCustomers(ctx, rows)
	if err != nil {
		return nil, 0, err
	}
	return accounts, total, nil
}

func (AcceptedAdminUsers) Account(ctx context.Context, userID string) (adminuser.Account, bool, error) {
	var rows []acceptedAccountRow
	err := sqlitex.DB.WithContext(ctx).
		Raw("SELECT "+acceptedAccountColumns+" "+acceptedAccountJoins+" WHERE "+clerkUsersU+" AND u.id = ?", userID).
		Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return adminuser.Account{}, false, err
	}
	accounts, err := withSelectedCustomers(ctx, rows[:1])
	if err != nil {
		return adminuser.Account{}, false, err
	}
	return accounts[0], true, nil
}

// withSelectedCustomers converts rows to accounts, setting each one's Customer
// from the user's stripe_customers, oldest first (the order PortalSessionOwners
// reads them in), and the accepted subscription's stored Customer and status.
func withSelectedCustomers(ctx context.Context, rows []acceptedAccountRow) ([]adminuser.Account, error) {
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	owned := map[string][]string{}
	if len(ids) > 0 {
		var customers []struct {
			UserID           string
			StripeCustomerID string
		}
		if err := sqlitex.DB.WithContext(ctx).
			Raw("SELECT `user_id`, `stripe_customer_id` FROM `stripe_customers` WHERE `user_id` IN ? ORDER BY `created_at`, rowid", ids).
			Scan(&customers).Error; err != nil {
			return nil, fmt.Errorf("read Stripe Customers: %w", err)
		}
		for _, c := range customers {
			owned[c.UserID] = append(owned[c.UserID], c.StripeCustomerID)
		}
	}
	accounts := make([]adminuser.Account, len(rows))
	for i, r := range rows {
		accounts[i] = accountRow{
			ID: r.ID, Email: r.Email, Name: r.Name, UserStatus: r.UserStatus, CreatedAt: r.CreatedAt,
			LastLoginTime: r.LastLoginTime, Plan: r.Plan, Status: r.Status,
			StripeCustomerID: sql.NullString{String: attribution.SelectCustomer(owned[r.ID], attribution.Accepted{
				SubscriptionID: r.AcceptedID.String,
				CustomerID:     r.AcceptedCustomerID.String,
				Status:         r.Status.String,
			})},
			SubscriptionBalance: r.SubscriptionBalance, TopupBalance: r.TopupBalance,
			TrialBalance: r.TrialBalance, TrialExpiresAt: r.TrialExpiresAt,
		}.account()
	}
	return accounts, nil
}
