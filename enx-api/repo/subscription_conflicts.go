package repo

import (
	"context"
	"fmt"
	"time"

	"enx-api/billing/conflict"
	"enx-api/billing/conflictadmin"
	"enx-api/billing/webhookevent"
	"enx-api/utils/sqlitex"
)

// SubscriptionConflicts is conflictadmin.Store over the subscriptions rows
// ENX classified as conflicts, with the webhook events that reference them
// (ADR-067 §管理员处理与邮件).
type SubscriptionConflicts struct{}

var _ conflictadmin.Store = SubscriptionConflicts{}

// conflictRow is a subscriptions row as conflictColumns reads it.
type conflictRow struct {
	StripeSubscriptionID       string
	UserID                     *string
	StripeCustomerID           string
	Status                     string
	Version                    int64
	ConflictReason             string
	ConflictWithSubscriptionID string
	ConflictDiscoveredAt       *int64
	ConflictStatus             string
	ConflictResolverID         string
	ConflictResolvedAt         *int64
	ConflictNotes              string
	SupportMessage             string
	SupportAt                  *int64
}

const conflictColumns = "`stripe_subscription_id`, `user_id`, `stripe_customer_id`, `status`, `version`, " +
	"`conflict_reason`, `conflict_with_subscription_id`, `conflict_discovered_at`, `conflict_status`, " +
	"`conflict_resolver_id`, `conflict_resolved_at`, `conflict_notes`, `support_message`, `support_at`"

// classificationConflict is the subscriptions.classification of a conflict.
const classificationConflict = "conflict"

// ListConflicts reads one page of conflicts in q.Status ("" for both),
// newest discovery first.
func (SubscriptionConflicts) ListConflicts(ctx context.Context, q conflict.ListQuery) ([]conflictadmin.Conflict, error) {
	query := "SELECT " + conflictColumns + " FROM `subscriptions` WHERE `classification` = ?"
	args := []any{classificationConflict}
	if q.Status != "" {
		query += " AND `conflict_status` = ?"
		args = append(args, string(q.Status))
	}
	query += " ORDER BY `conflict_discovered_at` DESC, `stripe_subscription_id` DESC LIMIT ? OFFSET ?"
	args = append(args, q.Limit, q.Offset)
	var rows []conflictRow
	if err := sqlitex.DB.WithContext(ctx).Raw(query, args...).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list subscription conflicts: %w", err)
	}
	conflicts := make([]conflictadmin.Conflict, 0, len(rows))
	for _, r := range rows {
		conflicts = append(conflicts, r.conflict())
	}
	return conflicts, nil
}

// Conflict reads the conflict row subscriptionID with its version. A row
// ENX does not have, or did not classify as a conflict, is
// conflictadmin.ErrNotFound.
func (SubscriptionConflicts) Conflict(ctx context.Context, subscriptionID string) (conflictadmin.Record, error) {
	var rows []conflictRow
	if err := sqlitex.DB.WithContext(ctx).Raw("SELECT "+conflictColumns+" FROM `subscriptions` "+
		"WHERE `stripe_subscription_id` = ? AND `classification` = ?",
		subscriptionID, classificationConflict).Scan(&rows).Error; err != nil {
		return conflictadmin.Record{}, fmt.Errorf("read subscription conflict: %w", err)
	}
	if len(rows) == 0 {
		return conflictadmin.Record{}, conflictadmin.ErrNotFound
	}
	return conflictadmin.Record{Version: rows[0].Version, Conflict: rows[0].conflict()}, nil
}

// Events reads every webhook event that references subscriptionID, oldest
// receipt first, each with all its deliveries, oldest first.
func (SubscriptionConflicts) Events(ctx context.Context, subscriptionID string) ([]conflictadmin.Event, error) {
	db := sqlitex.DB.WithContext(ctx)
	var rows []webhookEventRow
	if err := db.Raw("SELECT "+webhookEventColumns+" FROM `stripe_webhook_events` WHERE `subscription_id` = ? "+
		"ORDER BY `first_received_at`, `event_id`", subscriptionID).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("read subscription conflict events: %w", err)
	}
	var deliveries []struct {
		StripeAccountID string
		Livemode        bool
		EventID         string
		ID              string
		ReceivedAt      int64
	}
	if err := db.Raw("SELECT d.`stripe_account_id`, d.`livemode`, d.`event_id`, d.`id`, d.`received_at` "+
		"FROM `stripe_webhook_deliveries` d JOIN `stripe_webhook_events` e "+
		"ON e.`stripe_account_id` = d.`stripe_account_id` AND e.`livemode` = d.`livemode` AND e.`event_id` = d.`event_id` "+
		"WHERE e.`subscription_id` = ? ORDER BY d.`received_at`, d.`id`", subscriptionID).Scan(&deliveries).Error; err != nil {
		return nil, fmt.Errorf("read subscription conflict deliveries: %w", err)
	}
	byScope := map[webhookevent.Scope][]conflictadmin.Delivery{}
	for _, d := range deliveries {
		scope := webhookevent.Scope{AccountID: d.StripeAccountID, Livemode: d.Livemode, EventID: d.EventID}
		byScope[scope] = append(byScope[scope], conflictadmin.Delivery{ID: d.ID, ReceivedAt: time.UnixMilli(d.ReceivedAt)})
	}
	events := make([]conflictadmin.Event, 0, len(rows))
	for _, r := range rows {
		s := r.storedTask()
		events = append(events, conflictadmin.Event{
			EventID:    s.Scope.EventID,
			Type:       s.Task.Type,
			Status:     s.Task.Status,
			Attempts:   s.Task.Attempts,
			LastError:  s.Task.LastError,
			Deliveries: byScope[s.Scope],
		})
	}
	return events, nil
}

// SaveResolution writes s.Resolution to the conflict row and moves its
// version on, only while the row is still at s.Version; otherwise it
// returns conflictadmin.ErrStale, and the service's next read tells a moved
// row from a missing one. Ownership, classification, the support request and
// the alerts stay as they are, so a pending alert is still sent.
func (SubscriptionConflicts) SaveResolution(ctx context.Context, s conflictadmin.ResolutionSave) error {
	res := sqlitex.DB.WithContext(ctx).Exec("UPDATE `subscriptions` SET `conflict_status` = ?, `conflict_resolver_id` = ?, `conflict_resolved_at` = ?, "+
		"`conflict_notes` = ?, `version` = `version` + 1, `updated_at` = ? "+
		"WHERE `stripe_subscription_id` = ? AND `classification` = ? AND `version` = ?",
		string(s.Resolution.Status), s.Resolution.ResolverID, unixMilliOrNil(s.Resolution.ResolvedAt), s.Resolution.Notes,
		time.Now().UnixMilli(), s.SubscriptionID, classificationConflict, s.Version)
	if res.Error != nil {
		return fmt.Errorf("save subscription conflict resolution: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return conflictadmin.ErrStale
	}
	return nil
}

func (r conflictRow) conflict() conflictadmin.Conflict {
	return conflictadmin.Conflict{
		SubscriptionID:         r.StripeSubscriptionID,
		AcceptedSubscriptionID: r.ConflictWithSubscriptionID,
		OwnerID:                deref(r.UserID),
		CustomerID:             r.StripeCustomerID,
		StripeStatus:           r.Status,
		Reason:                 r.ConflictReason,
		DiscoveredAt:           timeOrZero(r.ConflictDiscoveredAt),
		Resolution: conflict.Resolution{
			Status:     conflict.Status(r.ConflictStatus),
			ResolverID: r.ConflictResolverID,
			ResolvedAt: timeOrZero(r.ConflictResolvedAt),
			Notes:      r.ConflictNotes,
		},
		Support: conflict.Support{Message: r.SupportMessage, At: timeOrZero(r.SupportAt)},
	}
}
