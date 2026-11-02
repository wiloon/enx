package repo

import (
	"context"

	"enx-api/utils/sqlitex"
)

// ReviewWord is one word on a user's review list and how many times they
// looked it up.
type ReviewWord struct {
	English    string
	QueryCount int
}

// ReviewWords reads users' review lists (ADR-069 Decision 1).
type ReviewWords struct{}

// List returns userID's review list: every live word they looked up and have
// not marked known. No definitions; the extension underlines from it.
func (ReviewWords) List(ctx context.Context, userID string) ([]ReviewWord, error) {
	words := []ReviewWord{}
	err := sqlitex.DB.WithContext(ctx).Raw(`
		SELECT w.english AS english, ud.query_count AS query_count
		FROM user_dicts ud
		JOIN words w ON w.id = ud.word_id
		WHERE ud.user_id = ? AND ud.query_count > 0 AND ud.known = 0
		  AND w.deleted_at IS NULL`, userID).Scan(&words).Error
	if err != nil {
		return nil, err
	}
	return words, nil
}
