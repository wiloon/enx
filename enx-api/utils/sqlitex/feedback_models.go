package sqlitex

// Feedback is one user feedback record (ADR-076): a text note, a page
// report, an article choice or a definition report, all in one table.
//
// Every row comes from something the user chose to send. URL is origin +
// path only (no query, fragment or credentials, opaque path segments
// redacted); see feedback.SanitizeURL. Rows never expire: they stay until an
// admin has looked at them and beyond, and go only with the account
// (ADR-062).
type Feedback struct {
	ID     string `gorm:"column:id;primaryKey"`
	UserID string `gorm:"column:user_id;not null;index:idx_feedback_user_created,priority:1"`
	Kind   string `gorm:"column:kind;not null;index"`
	URL    string `gorm:"column:url;not null;default:''"`
	Host   string `gorm:"column:host;not null;default:''"`
	Text   string `gorm:"column:text;not null;default:''"`
	// Context and Details are JSON objects: the scene the record was sent
	// from (extension version, adapter, ...) and the kind's own fields.
	Context   string `gorm:"column:context;not null;default:'{}'"`
	Details   string `gorm:"column:details;not null;default:'{}'"`
	Status    string `gorm:"column:status;not null;default:'new';index"`
	CreatedAt int64  `gorm:"column:created_at;not null;index;index:idx_feedback_user_created,priority:2"` // Unix milliseconds
}

func (Feedback) TableName() string {
	return "feedback"
}
