package adapters

import (
	"context"

	"enx-api/utils/sqlitex"
)

// LookedUpWords reads previously looked-up words, including known words, within the requested batch.
type LookedUpWords struct{}

func (LookedUpWords) LookedUpWords(ctx context.Context, userID string, requested []string) ([]string, error) {
	var words []string
	err := sqlitex.DB.WithContext(ctx).Table("user_dicts").
		Joins("JOIN words ON words.id = user_dicts.word_id").
		Where("user_dicts.user_id = ? AND user_dicts.query_count > 0 AND words.deleted_at IS NULL", userID).
		Where("words.english IN (?)", requested).
		Pluck("words.english", &words).Error
	return words, err
}
