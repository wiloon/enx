package sqlitex

// GORM models for invite links (ADR-051). Times are Unix milliseconds.

// ReferralCode is a user's invite code: one per user, never changed.
type ReferralCode struct {
	UserId    string `gorm:"column:user_id;primaryKey"`
	Code      string `gorm:"column:code;not null;uniqueIndex"`
	CreatedAt int64  `gorm:"column:created_at;not null"`
}

func (ReferralCode) TableName() string {
	return "referral_codes"
}

// Referral is an invitee's claim of a referrer's code; the primary key makes
// it one per invitee for life. The first_payment_* columns stay NULL until
// the invitee's first payment, then never change.
type Referral struct {
	InviteeUserId  string `gorm:"column:invitee_user_id;primaryKey"`
	ReferrerUserId string `gorm:"column:referrer_user_id;not null;index"`
	Code           string `gorm:"column:code;not null"`
	ClaimedAt      int64  `gorm:"column:claimed_at;not null"`
	// Status: claimed | pending | rewarded | forfeited | no_reward
	Status string `gorm:"column:status;not null;index:idx_referrals_due,priority:1"`
	// RewardsBlocked: set at claim time when the invitee's email had a
	// trial on a deleted account (ADR-062 Decision 3); the first payment
	// then records no_reward.
	RewardsBlocked bool `gorm:"column:rewards_blocked;not null;default:false"`

	FirstPaymentKind      *string `gorm:"column:first_payment_kind"` // subscription | topup
	FirstPaymentIntentId  *string `gorm:"column:first_payment_intent_id"`
	FirstPaymentInvoiceId *string `gorm:"column:first_payment_invoice_id"` // subscriptions only
	FirstPaymentCredits   int64   `gorm:"column:first_payment_credits;not null;default:0"`
	FirstPaidAt           *int64  `gorm:"column:first_paid_at"`

	// RewardAmount is fixed when the first payment is recorded.
	RewardAmount  int64  `gorm:"column:reward_amount;not null;default:0"`
	RewardDueAt   *int64 `gorm:"column:reward_due_at;index:idx_referrals_due,priority:2"`
	ForfeitReason string `gorm:"column:forfeit_reason"` // refunded | disputed | referrer_deleted
	RewardedAt    *int64 `gorm:"column:rewarded_at"`
	UpdatedAt     int64  `gorm:"column:updated_at;not null"`
}

func (Referral) TableName() string {
	return "referrals"
}
