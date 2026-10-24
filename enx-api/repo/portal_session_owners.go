package repo

import (
	"context"
	"fmt"

	"enx-api/billing/acceptance"
	"enx-api/billing/attribution"
	"enx-api/billing/conflict"
	"enx-api/billing/eligibility"
	"enx-api/billing/portalsession"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// PortalSessionOwners is portalsession.Store over the deletion gate, the
// user's subscriptions rows, its accepted pointer and its Stripe Customer
// ownership (ADR-067 §正常重新购买与购买阻断, §一次性充值与 Stripe Customer).
type PortalSessionOwners struct{}

var _ portalsession.Store = PortalSessionOwners{}

// Owner reads what the Portal session rules need about userID, in one read
// transaction so the parts agree. An accepted pointer to a subscription
// userID does not own is an error: the Portal must never open on a Customer
// the user may not own.
func (PortalSessionOwners) Owner(ctx context.Context, userID string) (portalsession.Owner, error) {
	var o portalsession.Owner
	err := sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		if o.Deletion, err = deletionState(tx, userID); err != nil {
			return err
		}
		if o.Owned, err = ownedSubscriptions(tx, userID); err != nil {
			return err
		}
		if o.AcceptedID, o.AcceptedCustomerID, err = acceptedSubscription(tx, userID); err != nil {
			return err
		}
		var customers []string
		if err := tx.Raw("SELECT `stripe_customer_id` FROM `stripe_customers` WHERE `user_id` = ? ORDER BY `created_at`, rowid",
			userID).Scan(&customers).Error; err != nil {
			return fmt.Errorf("read Stripe Customers: %w", err)
		}
		o.CustomerID = attribution.SelectCustomer(customers, attribution.Accepted{})
		return nil
	})
	if err != nil {
		return portalsession.Owner{}, fmt.Errorf("read portal session owner %s: %w", userID, err)
	}
	return o, nil
}

// deletionState reads userID's deletion gate. The gate outlives the users
// row, so a deleted user still reads as DeletionCompleted.
func deletionState(tx *gorm.DB, userID string) (acceptance.Deletion, error) {
	var states []string
	if err := tx.Raw("SELECT `state` FROM `account_deletion_gates` WHERE `user_id` = ?", userID).Scan(&states).Error; err != nil {
		return acceptance.NoDeletion, fmt.Errorf("read deletion gate: %w", err)
	}
	if len(states) == 0 {
		return acceptance.NoDeletion, nil
	}
	switch states[0] {
	case "in_progress":
		return acceptance.DeletionInProgress, nil
	case "deleted":
		return acceptance.DeletionCompleted, nil
	}
	return acceptance.NoDeletion, fmt.Errorf("deletion gate in unknown state %q", states[0])
}

// ownedSubscriptions reads every subscription userID owns, whatever its
// classification, oldest first. A conflict with no recorded resolution
// counts as open, so it blocks rather than slips through.
func ownedSubscriptions(tx *gorm.DB, userID string) ([]eligibility.Owned, error) {
	var rows []struct {
		StripeSubscriptionID string
		Status               string
		Classification       string
		ConflictStatus       string
	}
	if err := tx.Raw("SELECT `stripe_subscription_id`, `status`, `classification`, `conflict_status` FROM `subscriptions` "+
		"WHERE `user_id` = ? ORDER BY `created_at`, `stripe_subscription_id`", userID).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("read owned subscriptions: %w", err)
	}
	var owned []eligibility.Owned
	for _, r := range rows {
		o := eligibility.Owned{ID: r.StripeSubscriptionID, StoredStatus: r.Status}
		if r.Classification == classificationConflict {
			o.Conflict = eligibility.ConflictOpen
			if r.ConflictStatus == string(conflict.Resolved) {
				o.Conflict = eligibility.ConflictResolved
			}
		}
		owned = append(owned, o)
	}
	return owned, nil
}

// acceptedSubscription reads userID's accepted subscription and its Stripe
// Customer, "" for both when there is none or no users row.
func acceptedSubscription(tx *gorm.DB, userID string) (id, customerID string, err error) {
	var pointers []string
	if err := tx.Raw("SELECT COALESCE(`accepted_subscription_id`, '') FROM `users` WHERE `id` = ?", userID).Scan(&pointers).Error; err != nil {
		return "", "", fmt.Errorf("read accepted subscription pointer: %w", err)
	}
	if len(pointers) == 0 || pointers[0] == "" {
		return "", "", nil
	}
	id = pointers[0]
	var customers []string
	if err := tx.Raw("SELECT `stripe_customer_id` FROM `subscriptions` WHERE `stripe_subscription_id` = ? AND `user_id` = ?",
		id, userID).Scan(&customers).Error; err != nil {
		return "", "", fmt.Errorf("read accepted subscription: %w", err)
	}
	if len(customers) == 0 {
		return "", "", fmt.Errorf("accepted subscription %s is not one the user owns", id)
	}
	return id, customers[0], nil
}
