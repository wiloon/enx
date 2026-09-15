package sqlitex

// GORM model for enx-ui's Reader "paste text" feature. See
// docs/architecture/adr-022-enx-ui-reader-persistence-and-retention.md for
// the retention (7-day TTL) and per-user document cap decisions.

type ReaderDocument struct {
	ID        string `gorm:"column:id;primaryKey"`
	UserID    string `gorm:"column:user_id;index"`
	Content   string `gorm:"column:content;not null"`
	CreatedAt int64  `gorm:"column:created_at;not null"`       // Unix milliseconds
	ExpiresAt int64  `gorm:"column:expires_at;not null;index"` // Unix milliseconds
}

func (ReaderDocument) TableName() string {
	return "reader_documents"
}
