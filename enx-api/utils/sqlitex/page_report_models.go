package sqlitex

// PageReport is a page the user told us Catglish could not process (see
// docs/architecture/adr-010-x-tweet-page-support.md Decision 8).
//
// Unlike everything in ADR-028's daily_stats, this table DOES hold a URL --
// which is why it exists only behind an explicit click: the extension shows
// the user the sanitized URL and sends nothing until they confirm. It is
// never written passively. URL is origin + path only (no query, fragment or
// credentials, opaque path segments redacted); see pagereport.SanitizeURL.
//
// Rows are short-lived (pagereport.retention) and capped per user.
type PageReport struct {
	ID         string `gorm:"column:id;primaryKey"`
	UserID     string `gorm:"column:user_id;not null;index"`
	URL        string `gorm:"column:url;not null"`
	Host       string `gorm:"column:host;not null;index"`
	Reason     string `gorm:"column:reason;not null"`
	Adapter    string `gorm:"column:adapter;not null;default:''"`
	ExtVersion string `gorm:"column:ext_version;not null;default:''"`
	CreatedAt  int64  `gorm:"column:created_at;not null;index"` // Unix milliseconds
}

func (PageReport) TableName() string {
	return "page_reports"
}
