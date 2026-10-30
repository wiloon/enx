package sqlitex

// GORM models for Stripe billing: subscriptions, the two-pool AI credit
// ledger, and the free dictionary-lookup daily quota.
// See docs/tasks/TASK-SPEC-enx-billing-stripe-subscription.md §1 for the
// field-by-field rationale and docs/architecture/adr-009-billing-stripe-subscription-and-ai-credits.md
// for the architecture decisions these implement.

type Subscription struct {
	UserId               string  `gorm:"column:user_id;index"`
	StripeCustomerId     string  `gorm:"column:stripe_customer_id;not null;index"`
	StripeSubscriptionId *string `gorm:"column:stripe_subscription_id;primaryKey"` // nil until first subscription
	Status               string  `gorm:"column:status;not null;default:none"`
	Plan                 string  `gorm:"column:plan"`               // "pro" | "pro-plus" | "max"; empty until the first checkout/invoice resolves it
	CurrentPeriodEnd     int64   `gorm:"column:current_period_end"` // Unix seconds, from Stripe
	CreatedAt            int64   `gorm:"column:created_at;not null"`
	UpdatedAt            int64   `gorm:"column:updated_at;not null"`
}

func (Subscription) TableName() string {
	return "subscriptions"
}

type CreditAccount struct {
	UserId              string `gorm:"column:user_id;primaryKey"`
	SubscriptionBalance int64  `gorm:"column:subscription_balance;not null;default:0"`
	TopupBalance        int64  `gorm:"column:topup_balance;not null;default:0"`
	PeriodEnd           int64  `gorm:"column:period_end"` // Unix seconds; reset by the renewal webhook
	// TrialBalance is the one-off sign-up trial (ADR-048). It counts only
	// while now < TrialExpiresAt; nil means no trial was ever granted.
	TrialBalance   int64  `gorm:"column:trial_balance;not null;default:0"`
	TrialExpiresAt *int64 `gorm:"column:trial_expires_at"` // Unix seconds
	UpdatedAt      int64  `gorm:"column:updated_at;not null"`
}

func (CreditAccount) TableName() string {
	return "credit_accounts"
}

// CreditTransaction is an append-only ledger row for reconciliation.
// Never updated after insert.
type CreditTransaction struct {
	Id            string  `gorm:"column:id;primaryKey"`
	UserId        string  `gorm:"column:user_id;index"`
	Type          string  `gorm:"column:type;not null"` // GRANT_SUBSCRIPTION | GRANT_TOPUP | GRANT_TRIAL | GRANT_REFERRAL_BONUS | GRANT_REFERRAL_REWARD | GRANT_ADMIN | DEDUCT_ADMIN | CLAWBACK | CONSUME | SETTLE | REFUND | EXPIRE
	Amount        int64   `gorm:"column:amount;not null"`
	BalanceAfter  int64   `gorm:"column:balance_after;not null"`
	StripeEventId *string `gorm:"column:stripe_event_id;uniqueIndex"` // nil for CONSUME rows; set for webhook-triggered GRANT rows (idempotency key)
	Feature       string  `gorm:"column:feature"`
	// StripePaymentIntentId is the payment behind a GRANT_TOPUP or
	// GRANT_SUBSCRIPTION row, so a refund can find what it paid for (ADR-049).
	StripePaymentIntentId *string `gorm:"column:stripe_payment_intent_id;index"`
	// RelatedTransactionId points a CLAWBACK row at the grant it claws back.
	RelatedTransactionId *string `gorm:"column:related_transaction_id"`
	Note                 string  `gorm:"column:note"` // free text: the admin's reason on GRANT_ADMIN / DEDUCT_ADMIN rows (ADR-049)
	CreatedAt            int64   `gorm:"column:created_at;not null"`
}

func (CreditTransaction) TableName() string {
	return "credit_transactions"
}
