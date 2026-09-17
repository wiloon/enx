package sqlitex

// GORM models for Stripe billing: subscriptions, the two-pool AI credit
// ledger, and the free dictionary-lookup daily quota.
// See docs/tasks/TASK-SPEC-enx-billing-stripe-subscription.md §1 for the
// field-by-field rationale and docs/architecture/adr-009-billing-stripe-subscription-and-ai-credits.md
// for the architecture decisions these implement.

type Subscription struct {
	UserId               string  `gorm:"column:user_id;primaryKey"`
	StripeCustomerId     string  `gorm:"column:stripe_customer_id;not null;uniqueIndex"`
	StripeSubscriptionId *string `gorm:"column:stripe_subscription_id;uniqueIndex"` // nil until first subscription
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
	UpdatedAt           int64  `gorm:"column:updated_at;not null"`
}

func (CreditAccount) TableName() string {
	return "credit_accounts"
}

// CreditTransaction is an append-only ledger row for reconciliation.
// Never updated after insert.
type CreditTransaction struct {
	Id            string  `gorm:"column:id;primaryKey"`
	UserId        string  `gorm:"column:user_id;index"`
	Type          string  `gorm:"column:type;not null"` // GRANT_SUBSCRIPTION | GRANT_TOPUP | CONSUME | EXPIRE
	Amount        int64   `gorm:"column:amount;not null"`
	BalanceAfter  int64   `gorm:"column:balance_after;not null"`
	StripeEventId *string `gorm:"column:stripe_event_id;uniqueIndex"` // nil for CONSUME rows; set for webhook-triggered GRANT rows (idempotency key)
	Feature       string  `gorm:"column:feature"`
	CreatedAt     int64   `gorm:"column:created_at;not null"`
}

func (CreditTransaction) TableName() string {
	return "credit_transactions"
}

// DictionaryLookupQuota counts dictionary lookup requests per user per UTC
// day -- every user, subscribed or not, gets a row (ADR-029). Two things
// readers get wrong:
//
//   - Count may exceed the user's limit: requests that were rejected with a
//     429 are still counted, because the overflow is the demand the limit
//     suppressed.
//   - It will not match daily_stats (ADR-028), which counts user actions on
//     the user's local day. This table counts requests on the UTC day, so a
//     day's allowance cannot be reset by changing the device clock.
//
// Rows before the ADR-029 rollout mean something narrower (free users only,
// and only while a limit was configured) -- watch that boundary in trends.
type DictionaryLookupQuota struct {
	UserId string `gorm:"column:user_id;primaryKey"`
	Date   string `gorm:"column:date;primaryKey"` // YYYY-MM-DD, UTC
	Count  int64  `gorm:"column:count;not null;default:0"`
}

func (DictionaryLookupQuota) TableName() string {
	return "dictionary_lookup_quota"
}
