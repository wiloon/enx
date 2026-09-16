package sqlitex

// GORM model for enx-ui's Reader "paste text" feature. See
// docs/architecture/adr-022-enx-ui-reader-persistence-and-retention.md for
// the retention (7-day TTL) and per-user document cap decisions.

// LastEditedAt (not the gorm-magic field name "UpdatedAt") because gorm
// unconditionally overwrites a real UpdatedAt field with wall-clock time on
// every Save/Update, clobbering the caller-supplied `now` that
// reader.UpdateDocument relies on for deterministic behavior and tests.
type ReaderDocument struct {
	ID        string `gorm:"column:id;primaryKey"`
	UserID    string `gorm:"column:user_id;index"`
	Content   string `gorm:"column:content;not null"`
	CreatedAt int64  `gorm:"column:created_at;not null"` // Unix milliseconds, set once
	// default:0 lets AutoMigrate's `ALTER TABLE ... ADD COLUMN` succeed
	// against a table that already has rows -- SQLite refuses to add a
	// NOT NULL column with no default otherwise. Legacy rows land on 0 and
	// are backfilled to created_at once in sqlitex.Init (see the "one-time
	// data migration" comment there); every row written by CreateDocument /
	// UpdateDocument always sets a real value, so the default is only ever
	// observed transiently, between the ALTER and the backfill.
	LastEditedAt int64 `gorm:"column:updated_at;not null;default:0"` // Unix milliseconds, bumped by UpdateDocument
	ExpiresAt    int64 `gorm:"column:expires_at;not null;index"`     // Unix milliseconds
}

func (ReaderDocument) TableName() string {
	return "reader_documents"
}
