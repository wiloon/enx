package sqlitex

// UserPreference is one explicit per-user setting (ADR-044). A key with no
// row is "unset": the registry in the preferences package supplies its
// default, so the table never stores defaults.
type UserPreference struct {
	UserId    string `gorm:"column:user_id;primaryKey"`
	Key       string `gorm:"column:key;primaryKey"`
	Value     string `gorm:"column:value;not null"` // JSON-encoded; booleans only today
	UpdatedAt int64  `gorm:"column:updated_at;not null"`
}

func (UserPreference) TableName() string {
	return "user_preferences"
}
