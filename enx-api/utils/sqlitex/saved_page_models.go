package sqlitex

// SavedPage is a page the user chose to save (ADR-032). Unlike PageReport it
// belongs to the user: it is only ever read back to them, never surfaced to an
// admin, and is kept until they delete it or their account.
//
// URL + title only. The article body and any translation are deliberately not
// stored (ADR-032 Decision 3).
type SavedPage struct {
	ID        string `gorm:"column:id;primaryKey"`
	UserID    string `gorm:"column:user_id;not null;index"`
	URL       string `gorm:"column:url;not null"`
	Title     string `gorm:"column:title;not null;default:''"`
	Host      string `gorm:"column:host;not null"`
	CreatedAt int64  `gorm:"column:created_at;not null;index"` // Unix milliseconds
}

func (SavedPage) TableName() string {
	return "saved_pages"
}
