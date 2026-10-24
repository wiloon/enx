package repo

import (
	"context"
	"fmt"
	"time"

	"enx-api/billing/alert"
	"enx-api/billing/billingsupport"
	"enx-api/billing/conflict"
	"enx-api/utils/sqlitex"
)

// BillingSupport is billingsupport.Store over the subscriptions rows: a
// user's billing-support request and its support alert live on the conflict
// row it is about (ADR-067 §管理员处理与邮件).
type BillingSupport struct{}

var _ billingsupport.Store = BillingSupport{}

// supportRow is a subscriptions row as supportColumns reads it.
type supportRow struct {
	UserID                     *string
	Classification             string
	Version                    int64
	SupportMessage             string
	SupportAt                  *int64
	SupportAlertState          string
	SupportAlertAttempts       int
	SupportAlertLastError      string
	SupportAlertNextAttemptAt  *int64
	SupportAlertSentAt         *int64
	SupportAlertClaimToken     string
	SupportAlertClaimExpiresAt *int64
}

const supportColumns = "`user_id`, `classification`, `version`, `support_message`, `support_at`, " +
	"`support_alert_state`, `support_alert_attempts`, `support_alert_last_error`, `support_alert_next_attempt_at`, " +
	"`support_alert_sent_at`, `support_alert_claim_token`, `support_alert_claim_expires_at`"

// Subscription reads subscriptionID's row with its version, support request
// and support alert. A row ENX does not have is billingsupport.ErrNotFound.
func (BillingSupport) Subscription(ctx context.Context, subscriptionID string) (billingsupport.Record, error) {
	var rows []supportRow
	if err := sqlitex.DB.WithContext(ctx).Raw("SELECT "+supportColumns+" FROM `subscriptions` WHERE `stripe_subscription_id` = ?",
		subscriptionID).Scan(&rows).Error; err != nil {
		return billingsupport.Record{}, fmt.Errorf("read billing support subscription: %w", err)
	}
	if len(rows) == 0 {
		return billingsupport.Record{}, billingsupport.ErrNotFound
	}
	r := rows[0]
	return billingsupport.Record{
		Version: r.Version,
		Subscription: conflict.Subscription{
			OwnerID:  deref(r.UserID),
			Conflict: r.Classification == classificationConflict,
			Support:  conflict.Support{Message: r.SupportMessage, At: timeOrZero(r.SupportAt)},
		},
		Alert: alert.Alert{
			State:          alert.State(r.SupportAlertState),
			Attempts:       r.SupportAlertAttempts,
			LastError:      r.SupportAlertLastError,
			NextAttemptAt:  timeOrZero(r.SupportAlertNextAttemptAt),
			SentAt:         timeOrZero(r.SupportAlertSentAt),
			ClaimToken:     r.SupportAlertClaimToken,
			ClaimExpiresAt: timeOrZero(r.SupportAlertClaimExpiresAt),
		},
	}, nil
}

// SaveSupport writes s.Support and its raised alert to the row and moves
// its version on, in one statement, only while the row is still at
// s.Version; otherwise it returns billingsupport.ErrStale, and the
// service's next read tells a moved row from a missing one. A support
// request changes no purchase eligibility, so the owner's billing revision,
// the conflict's resolution and its conflict alert stay as they are.
func (BillingSupport) SaveSupport(ctx context.Context, s billingsupport.Save) error {
	a := s.Alert
	res := sqlitex.DB.WithContext(ctx).Exec("UPDATE `subscriptions` SET `support_message` = ?, `support_at` = ?, "+
		"`support_alert_state` = ?, `support_alert_attempts` = ?, `support_alert_last_error` = ?, `support_alert_next_attempt_at` = ?, "+
		"`support_alert_sent_at` = ?, `support_alert_claim_token` = ?, `support_alert_claim_expires_at` = ?, "+
		"`version` = `version` + 1, `updated_at` = ? "+
		"WHERE `stripe_subscription_id` = ? AND `version` = ?",
		s.Support.Message, unixMilliOrNil(s.Support.At),
		string(a.State), a.Attempts, a.LastError, unixMilliOrNil(a.NextAttemptAt),
		unixMilliOrNil(a.SentAt), a.ClaimToken, unixMilliOrNil(a.ClaimExpiresAt),
		time.Now().UnixMilli(), s.SubscriptionID, s.Version)
	if res.Error != nil {
		return fmt.Errorf("save billing support request: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return billingsupport.ErrStale
	}
	return nil
}
