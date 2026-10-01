// Package adapters backs preferences.Store with the user_preferences table.
package adapters

import (
	"context"
	"encoding/json"
	"time"

	"enx-api/preferences"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm/clause"
)

// Table stores preferences as rows of (user_id, key, JSON value).
type Table struct{}

var _ preferences.Store = Table{}

// Load returns userID's explicit boolean values. A row whose value is not a
// boolean is skipped (treated as unset) rather than failing the whole read.
func (Table) Load(ctx context.Context, userID string) (map[preferences.Key]bool, error) {
	var rows []sqlitex.UserPreference
	if err := sqlitex.DB.WithContext(ctx).Where("user_id = ?", userID).Find(&rows).Error; err != nil {
		return nil, err
	}
	values := make(map[preferences.Key]bool, len(rows))
	for _, row := range rows {
		var v bool
		if err := json.Unmarshal([]byte(row.Value), &v); err != nil {
			logger.Warnf("preferences: ignoring non-boolean value for %s (user %s): %v", row.Key, userID, err)
			continue
		}
		values[preferences.Key(row.Key)] = v
	}
	return values, nil
}

// Save upserts one explicit value.
func (Table) Save(ctx context.Context, userID string, key preferences.Key, value bool) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return sqlitex.DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
	}).Create(&sqlitex.UserPreference{
		UserId:    userID,
		Key:       string(key),
		Value:     string(encoded),
		UpdatedAt: time.Now().UnixMilli(),
	}).Error
}

// Clear deletes an explicit value, returning the key to its default. Clearing
// a key that has no row is not an error.
func (Table) Clear(ctx context.Context, userID string, key preferences.Key) error {
	return sqlitex.DB.WithContext(ctx).
		Where("user_id = ? AND key = ?", userID, string(key)).
		Delete(&sqlitex.UserPreference{}).Error
}
