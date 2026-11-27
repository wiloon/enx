package sqlitex

// ReviewState is one user's FSRS schedule for one word (ADR-097 Decision 6).
// Times are Unix milliseconds.
type ReviewState struct {
	UserID     string  `gorm:"column:user_id;primaryKey"`
	WordID     string  `gorm:"column:word_id;primaryKey;index:idx_review_states_word_id"`
	Stability  float64 `gorm:"column:stability;not null"`
	Difficulty float64 `gorm:"column:difficulty;not null"`
	Phase      int     `gorm:"column:phase;not null"` // go-fsrs State
	Due        int64   `gorm:"column:due;not null"`
	LastReview int64   `gorm:"column:last_review;not null"`
	Reps       int     `gorm:"column:reps;not null"`
	// Lapses counts the known words looked up again (ADR-097 Decision 5),
	// not go-fsrs's Card.Lapses.
	Lapses      int    `gorm:"column:lapses;not null"`
	LastLapseAt *int64 `gorm:"column:last_lapse_at"`
	// LookupRescheduledAt is the last lookup that rescheduled the word.
	LookupRescheduledAt *int64 `gorm:"column:lookup_rescheduled_at"`
}

func (ReviewState) TableName() string {
	return "review_states"
}

// ReviewLog is one memory signal (ADR-097 Decision 6).
type ReviewLog struct {
	ID     int64  `gorm:"column:id;primaryKey;autoIncrement"`
	UserID string `gorm:"column:user_id;not null;index:idx_review_logs_user_word,priority:1"`
	WordID string `gorm:"column:word_id;not null;index:idx_review_logs_user_word,priority:2;index:idx_review_logs_word_id"`
	At     int64  `gorm:"column:at;not null"` // Unix milliseconds
	Type   string `gorm:"column:type;not null"`
	Source string `gorm:"column:source;not null"`
	// Rescheduled is set on lookups only: whether the lookup rescheduled.
	Rescheduled *bool `gorm:"column:rescheduled"`
}

func (ReviewLog) TableName() string {
	return "review_logs"
}
