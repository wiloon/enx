package adapters

import (
	"context"

	"enx-api/utils/sqlitex"
)

// LookedUpWords reads previously looked-up words, including known words.
type LookedUpWords struct{}

func (LookedUpWords) LookedUpWords(ctx context.Context, userID string) ([]string, error) {
	var words []string
	err := sqlitex.DB.WithContext(ctx).Table("user_dicts").
		Joins("JOIN words ON words.id = user_dicts.word_id").
		Where("user_dicts.user_id = ? AND user_dicts.query_count > 0 AND words.deleted_at IS NULL", userID).
		Pluck("words.english", &words).Error
	return words, err
}
