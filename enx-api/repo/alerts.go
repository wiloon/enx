package repo

import (
	"context"
	"fmt"
	"time"

	"enx-api/billing/alert"
	"enx-api/utils/sqlitex"
)

// Alerts is alert.Store over the rows each durable administrator alert lives
// on (ADR-067 §管理员处理与邮件): an event's attention alert on its
// stripe_webhook_events row, a conflict's discovery and support alerts on
// the conflicting subscriptions row.
type Alerts struct{}

var _ alert.Store = Alerts{}

// pendingAlertRow is one pending alert as the Pending queries read it: the
// row's identity, what the alert's mail names, and its delivery state.
type pendingAlertRow struct {
	ID                  string
	AccountID           string
	Livemode            bool
	EventType           string
	Reason              string
	SubscriptionID      string
	OwnerID             *string
	CustomerID          string
	InvoiceID           string
	PaymentIntentID     string
	ChargeID            string
	WithSubscriptionID  string
	At                  *int64
	AlertState          string
	AlertAttempts       int
	AlertLastError      string
	AlertNextAttemptAt  *int64
	AlertSentAt         *int64
	AlertClaimToken     string
	AlertClaimExpiresAt *int64
}

// alertColumns selects prefix's alert columns as pendingAlertRow's.
func alertColumns(prefix string) string {
	return fmt.Sprintf("`%[1]s_state` AS alert_state, `%[1]s_attempts` AS alert_attempts, "+
		"`%[1]s_last_error` AS alert_last_error, `%[1]s_next_attempt_at` AS alert_next_attempt_at, "+
		"`%[1]s_sent_at` AS alert_sent_at, `%[1]s_claim_token` AS alert_claim_token, "+
		"`%[1]s_claim_expires_at` AS alert_claim_expires_at", prefix)
}

func (r pendingAlertRow) alert() alert.Alert {
	return alert.Alert{
		State:          alert.State(r.AlertState),
		Attempts:       r.AlertAttempts,
		LastError:      r.AlertLastError,
		NextAttemptAt:  timeOrZero(r.AlertNextAttemptAt),
		SentAt:         timeOrZero(r.AlertSentAt),
		ClaimToken:     r.AlertClaimToken,
		ClaimExpiresAt: timeOrZero(r.AlertClaimExpiresAt),
	}
}

// Pending returns every pending alert with what its mail is composed from.
// An event's reason is the task's last error, the reason it was escalated.
func (Alerts) Pending(ctx context.Context) ([]alert.Stored, error) {
	db := sqlitex.DB.WithContext(ctx)
	var events, conflicts, supports []pendingAlertRow
	if err := db.Raw("SELECT `event_id` AS id, `stripe_account_id` AS account_id, `livemode`, `type` AS event_type, "+
		"`last_error` AS reason, `subscription_id`, `customer_id`, `invoice_id`, `payment_intent_id`, `charge_id`, "+
		alertColumns("alert")+" FROM `stripe_webhook_events` "+
		"WHERE `alert_state` = ? ORDER BY `first_received_at`, `event_id`", string(alert.Pending)).Scan(&events).Error; err != nil {
		return nil, fmt.Errorf("read pending event alerts: %w", err)
	}
	if err := db.Raw("SELECT `stripe_subscription_id` AS id, `user_id` AS owner_id, `stripe_customer_id` AS customer_id, "+
		"`conflict_reason` AS reason, `conflict_with_subscription_id` AS with_subscription_id, `conflict_discovered_at` AS at, "+
		alertColumns("conflict_alert")+" FROM `subscriptions` "+
		"WHERE `conflict_alert_state` = ? ORDER BY `conflict_discovered_at`, `stripe_subscription_id`",
		string(alert.Pending)).Scan(&conflicts).Error; err != nil {
		return nil, fmt.Errorf("read pending conflict alerts: %w", err)
	}
	if err := db.Raw("SELECT `stripe_subscription_id` AS id, `user_id` AS owner_id, `support_at` AS at, "+
		alertColumns("support_alert")+" FROM `subscriptions` "+
		"WHERE `support_alert_state` = ? ORDER BY `support_at`, `stripe_subscription_id`",
		string(alert.Pending)).Scan(&supports).Error; err != nil {
		return nil, fmt.Errorf("read pending support alerts: %w", err)
	}

	stored := make([]alert.Stored, 0, len(events)+len(conflicts)+len(supports))
	for _, e := range events {
		stored = append(stored, alert.Stored{
			Ref:   alert.Ref{Kind: alert.EventAttentionAlert, ID: e.ID, AccountID: e.AccountID, Livemode: e.Livemode},
			Alert: e.alert(),
			Content: alert.EventAttention{
				AccountID: e.AccountID, Livemode: e.Livemode, EventID: e.ID, EventType: e.EventType, Reason: e.Reason,
				SubscriptionID: e.SubscriptionID, CustomerID: e.CustomerID, InvoiceID: e.InvoiceID,
				PaymentIntentID: e.PaymentIntentID, ChargeID: e.ChargeID,
			},
		})
	}
	for _, c := range conflicts {
		stored = append(stored, alert.Stored{
			Ref:   alert.Ref{Kind: alert.ConflictAlert, ID: c.ID},
			Alert: c.alert(),
			Content: alert.ConflictFound{
				SubscriptionID: c.ID, AcceptedSubscriptionID: c.WithSubscriptionID, OwnerID: deref(c.OwnerID),
				CustomerID: c.CustomerID, Reason: c.Reason, DiscoveredAt: timeOrZero(c.At),
			},
		})
	}
	for _, s := range supports {
		stored = append(stored, alert.Stored{
			Ref:     alert.Ref{Kind: alert.SupportAlert, ID: s.ID},
			Alert:   s.alert(),
			Content: alert.SupportRequested{SubscriptionID: s.ID, OwnerID: deref(s.OwnerID), RequestedAt: timeOrZero(s.At)},
		})
	}
	return stored, nil
}

// Save writes next as ref's alert, in one statement, only while the stored
// State, Attempts and ClaimToken still equal read's; otherwise it returns
// alert.ErrStaleClaim and changes nothing. It writes no other column of the
// row but its write time, and on a subscriptions row the version, which
// every write to that row moves on. An alert whose row ENX does not have is
// an error, not a stale claim.
func (Alerts) Save(ctx context.Context, ref alert.Ref, read, next alert.Alert) error {
	var table, prefix, where, touch string
	var key []any
	switch ref.Kind {
	case alert.EventAttentionAlert:
		table, prefix, touch = "stripe_webhook_events", "alert", ""
		where, key = "`stripe_account_id` = ? AND `livemode` = ? AND `event_id` = ?", []any{ref.AccountID, ref.Livemode, ref.ID}
	case alert.ConflictAlert, alert.SupportAlert:
		table, prefix, touch = "subscriptions", "conflict_alert", ", `version` = `version` + 1"
		if ref.Kind == alert.SupportAlert {
			prefix = "support_alert"
		}
		where, key = "`stripe_subscription_id` = ?", []any{ref.ID}
	default:
		return fmt.Errorf("save alert: unknown kind %q", ref.Kind)
	}

	db := sqlitex.DB.WithContext(ctx)
	args := []any{string(next.State), next.Attempts, next.LastError, unixMilliOrNil(next.NextAttemptAt),
		unixMilliOrNil(next.SentAt), next.ClaimToken, unixMilliOrNil(next.ClaimExpiresAt), time.Now().UnixMilli()}
	args = append(args, key...)
	args = append(args, string(read.State), read.Attempts, read.ClaimToken)
	res := db.Exec(fmt.Sprintf("UPDATE `%[1]s` SET `%[2]s_state` = ?, `%[2]s_attempts` = ?, `%[2]s_last_error` = ?, "+
		"`%[2]s_next_attempt_at` = ?, `%[2]s_sent_at` = ?, `%[2]s_claim_token` = ?, `%[2]s_claim_expires_at` = ?, "+
		"`updated_at` = ?%[3]s WHERE %[4]s AND `%[2]s_state` = ? AND `%[2]s_attempts` = ? AND `%[2]s_claim_token` = ?",
		table, prefix, touch, where), args...)
	if res.Error != nil {
		return fmt.Errorf("save %s alert: %w", ref.Kind, res.Error)
	}
	if res.RowsAffected > 0 {
		return nil
	}
	var n int64
	if err := db.Raw(fmt.Sprintf("SELECT count(*) FROM `%s` WHERE %s", table, where), key...).Scan(&n).Error; err != nil {
		return fmt.Errorf("read %s alert: %w", ref.Kind, err)
	}
	if n == 0 {
		return fmt.Errorf("save %s alert: no row for %+v", ref.Kind, ref)
	}
	return alert.ErrStaleClaim
}
