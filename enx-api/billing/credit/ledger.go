// Package credit implements the AI credit ledger's pools and its non-Stripe
// writers: settlement, admin adjustments, trials and referral grants. Paid
// grants and refund clawbacks are written by the ADR-067 webhook handlers
// through repo.WebhookEffects.Apply and repo.ApplyClawback. See
// docs/architecture/adr-009-billing-stripe-subscription-and-ai-credits.md
// Decision 5 (atomic conditional-update scheme) for the design this
// implements.
package credit

import (
	"errors"

	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// ErrInsufficientCredit is returned by Consume when neither the
// subscription nor the top-up pool covers cost. Callers should map this to
// HTTP 402.
var ErrInsufficientCredit = errors.New("credit: insufficient balance")

const (
	TypeConsume = "CONSUME"
	TypeRefund  = "REFUND"
	TypeExpire  = "EXPIRE"
	// TypeSettle marks a Settle row: a post-hoc deduction for a
	// token-metered feature whose AI call already completed (ADR-012).
	// Distinct from TypeConsume so accounting can tell "charged after the
	// fact, may have gone negative" from "checked-then-charged".
	TypeSettle = "SETTLE"
)

// ensureAccount creates a zero-balance credit_accounts row for userID if
// one doesn't exist yet, so the writers' conditional UPDATEs always have a
// row to match against.
func ensureAccount(tx *gorm.DB, userID string, now int64) error {
	return tx.Where(sqlitex.CreditAccount{UserId: userID}).
		Attrs(sqlitex.CreditAccount{UpdatedAt: now}).
		FirstOrCreate(&sqlitex.CreditAccount{}).Error
}

func eventAlreadyProcessed(tx *gorm.DB, stripeEventID string) (bool, error) {
	var count int64
	if err := tx.Model(&sqlitex.CreditTransaction{}).
		Where("stripe_event_id = ?", stripeEventID).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func insertLedgerRow(tx *gorm.DB, txn sqlitex.CreditTransaction) error {
	return tx.Create(&txn).Error
}
