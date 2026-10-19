package sqlitex

// TrialGrant is the trial grant record (ADR-062 Decision 3): one row per
// email that was ever granted the sign-up trial, kept when the account is
// deleted. EmailHmac is HMAC-SHA256 of the normalized email, never the email
// itself; UserId is the local user that got the trial.
type TrialGrant struct {
	EmailHmac string `gorm:"column:email_hmac;primaryKey"`
	UserId    string `gorm:"column:user_id;not null"`
	GrantedAt int64  `gorm:"column:granted_at;not null"` // Unix milliseconds
}

func (TrialGrant) TableName() string {
	return "trial_grants"
}
