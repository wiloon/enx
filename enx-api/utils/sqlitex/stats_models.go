package sqlitex

// GORM models for the reading statistics (ADR-028). See
// docs/architecture/adr-028-reading-stats-what-to-measure.md for what each
// metric means and, just as importantly, what is deliberately NOT stored.

// DailyStat is one user's counters for one of *their* local days -- one row
// per user per day, so a year of a heavy user costs 365 rows. Curves for
// day / week / month / year are all SUM/GROUP BY over this table
// (ADR-028 Options B2); adding a metric is adding a column.
//
// There is no URL, host, page title, article id or wall-clock timestamp
// anywhere in this table, by design (ADR-028 Decision 10): every row here
// should be something we could show the user verbatim without discomfort.
// Which article they read is a client-side concept that never leaves the
// extension.
//
// Date is the USER'S LOCAL day, reported by the client, and deliberately
// differs from dictionary_lookup_quota's UTC day. The two answer different
// questions: this one is "how much did I learn today", which has to line up
// with the user's own sense of a day; the quota is an adversarial cap, and a
// local boundary could be reset by changing the device clock (ADR-029
// Decision 6). The two tables' numbers are expected NOT to match.
type DailyStat struct {
	UserID string `gorm:"column:user_id;primaryKey"`
	Date   string `gorm:"column:date;primaryKey"` // YYYY-MM-DD in the user's local time
	// Kept for diagnosing a suspicious Date, never used in aggregation.
	UTCOffsetMinutes int `gorm:"column:utc_offset_minutes;not null;default:0"`

	// v1 metrics.
	WordsRead     int64 `gorm:"column:words_read;not null;default:0"` // estimated, see ADR-028 Decision 2
	ArticlesRead  int64 `gorm:"column:articles_read;not null;default:0"`
	WordLookups   int64 `gorm:"column:word_lookups;not null;default:0"` // L1
	NewWords      int64 `gorm:"column:new_words;not null;default:0"`
	WordsMastered int64 `gorm:"column:words_mastered;not null;default:0"` // L1'

	// v1.1 metrics. Created up front with a 0 default so turning them on is
	// only a client-side change, never a migration (ADR-028 Decision 4).
	PhraseLookups        int64 `gorm:"column:phrase_lookups;not null;default:0"`        // L1.5
	SentenceTranslations int64 `gorm:"column:sentence_translations;not null;default:0"` // L2
	ContextLookups       int64 `gorm:"column:context_lookups;not null;default:0"`       // L3
}

func (DailyStat) TableName() string {
	return "daily_stats"
}

// StatsIngestLog deduplicates stats reports. The extension retries a failed
// report with the same ClientEventID, so replaying one must not double-count
// (ADR-028 Decision 5). Rows are short-lived: the retry window is minutes,
// the TTL is days, and runStatsIngestLogCleanup deletes the rest.
type StatsIngestLog struct {
	ClientEventID string `gorm:"column:client_event_id;primaryKey"`
	UserID        string `gorm:"column:user_id;index"`
	CreatedAt     int64  `gorm:"column:created_at;not null;index"` // Unix milliseconds
}

func (StatsIngestLog) TableName() string {
	return "stats_ingest_log"
}

// LookupEvent is one dictionary lookup request (ADR-059 Decision 1). The
// daily lookup quota, the lookup counts in /stats and active users are all
// derived from this table.
//
// No word, URL or page is stored: which word was looked up is already in
// user_dicts, and an event only has to be counted. Rows are kept for
// stats.lookup-events.retention-days (at most 100, the privacy-policy
// promise), then rolled up into daily_stats.word_lookups and deleted.
type LookupEvent struct {
	UserID string `gorm:"column:user_id;not null;index:idx_lookup_events_user_at,priority:1"`
	// UTC Unix milliseconds.
	At int64 `gorm:"column:at;not null;index:idx_lookup_events_user_at,priority:2;index:idx_lookup_events_at"`
	// The caller's UTC offset for this lookup (Beijing +480), from
	// X-Enx-Tz-Offset; 0 without the header. The event's local day is the
	// date of At + TZOffsetMinutes.
	TZOffsetMinutes int `gorm:"column:tz_offset_minutes;not null"`
	// "allowed" or "rejected" (answered with a 429).
	Outcome string `gorm:"column:outcome;not null"`
}

func (LookupEvent) TableName() string {
	return "lookup_events"
}
