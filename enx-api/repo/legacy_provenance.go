package repo

import (
	"context"
	"fmt"

	"enx-api/billing/invoicepaid"
	"enx-api/billing/legacyprovenance"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// LegacyProvenance is legacyprovenance.Store over the ledger: the grant a
// migrated pool comes from is the one credit_accounts.pool_grant_id points
// at (MigrateCreditProvenance), and its provenance goes on that
// credit_transactions row (ADR-067 §一次性充值与 Stripe Customer).
type LegacyProvenance struct{}

var _ legacyprovenance.Store = LegacyProvenance{}

// Unrecorded returns the grant behind each pool whose user's accepted
// subscription was migrated, while the grant still has no Subscription ID.
// A deleted user has no users row and so no accepted subscription.
func (LegacyProvenance) Unrecorded(ctx context.Context) ([]legacyprovenance.Grant, error) {
	var rows []struct {
		TransactionID   string
		SubscriptionID  string
		PoolPeriodEnd   int64
		PaymentIntentID string
	}
	if err := sqlitex.DB.WithContext(ctx).Raw("SELECT t.`id` AS transaction_id, u.`accepted_subscription_id` AS subscription_id, " +
		"a.`period_end` AS pool_period_end, COALESCE(t.`stripe_payment_intent_id`, '') AS payment_intent_id " +
		"FROM `credit_accounts` a " +
		"JOIN `credit_transactions` t ON t.`id` = a.`pool_grant_id` " +
		"JOIN `users` u ON u.`id` = a.`user_id` " +
		"WHERE u.`accepted_subscription_id` IS NOT NULL AND a.`period_end` IS NOT NULL AND t.`stripe_subscription_id` IS NULL " +
		"ORDER BY t.`id`").Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("read unrecorded legacy grants: %w", err)
	}
	grants := make([]legacyprovenance.Grant, 0, len(rows))
	for _, r := range rows {
		grants = append(grants, legacyprovenance.Grant(r))
	}
	return grants, nil
}

// Record writes grant's provenance as a normal period grant: the pinned
// invoice and period, which must end where the pool does, or, without a
// period, its subscription and the pool's period end with r.Reason. It
// moves the owner's billing revision on, since credit decisions read a
// grant's Source under it. A grant already recorded, by a run that raced
// this one, is left as it is.
func (LegacyProvenance) Record(ctx context.Context, grant legacyprovenance.Grant, r legacyprovenance.Result) error {
	invoiceID, periodStart := any(nil), any(nil)
	switch {
	case r.Pinned && (r.InvoiceID == "" || r.Source.SubscriptionID != grant.SubscriptionID || r.Source.Period.End != grant.PoolPeriodEnd):
		return fmt.Errorf("record legacy provenance of %s: pinned to invoice %q of %q ending at %d, want an invoice of %s ending at %d",
			grant.TransactionID, r.InvoiceID, r.Source.SubscriptionID, r.Source.Period.End, grant.SubscriptionID, grant.PoolPeriodEnd)
	case r.Pinned:
		invoiceID, periodStart = r.InvoiceID, r.Source.Period.Start
	case r.Reason == "":
		return fmt.Errorf("record legacy provenance of %s: no period and no reason", grant.TransactionID)
	}
	return sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Exec("UPDATE `credit_transactions` SET `grant_kind` = ?, `stripe_subscription_id` = ?, `stripe_invoice_id` = ?, "+
			"`period_start` = ?, `period_end` = ?, `without_period` = ?, `provenance_reason` = ? "+
			"WHERE `id` = ? AND `type` = 'GRANT_SUBSCRIPTION' AND `stripe_subscription_id` IS NULL",
			string(invoicepaid.NormalGrant), grant.SubscriptionID, invoiceID, periodStart, grant.PoolPeriodEnd, !r.Pinned, r.Reason, grant.TransactionID)
		if res.Error != nil {
			return fmt.Errorf("record legacy provenance of %s: %w", grant.TransactionID, res.Error)
		}
		if res.RowsAffected == 0 {
			var recorded int64
			if err := tx.Raw("SELECT count(*) FROM `credit_transactions` WHERE `id` = ? AND `type` = 'GRANT_SUBSCRIPTION'",
				grant.TransactionID).Scan(&recorded).Error; err != nil {
				return fmt.Errorf("record legacy provenance of %s: %w", grant.TransactionID, err)
			}
			if recorded == 0 {
				return fmt.Errorf("record legacy provenance: no GRANT_SUBSCRIPTION %s", grant.TransactionID)
			}
			return nil
		}
		if err := tx.Exec("UPDATE `users` SET `billing_version` = `billing_version` + 1 "+
			"WHERE `id` = (SELECT `user_id` FROM `credit_transactions` WHERE `id` = ?)", grant.TransactionID).Error; err != nil {
			return fmt.Errorf("record legacy provenance of %s: move the billing revision on: %w", grant.TransactionID, err)
		}
		return nil
	})
}

// MarkDone records that the backfill finished: the LegacyBackfillMarker
// WebhookEvents.LegacyBackfillDone reads.
func (LegacyProvenance) MarkDone(ctx context.Context) error {
	return MarkLegacyBackfillDone(ctx)
}
