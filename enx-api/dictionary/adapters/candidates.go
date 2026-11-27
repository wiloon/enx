package adapters

import (
	"context"
	"errors"
	"time"

	"enx-api/dictionary"
	"enx-api/repo"
	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AICandidates is the dictionary.CandidateStore backed by the ai_candidates
// table (ADR-091).
type AICandidates struct{}

func (AICandidates) FindCandidate(ctx context.Context, english string) (dictionary.Candidate, bool, error) {
	var row sqlitex.AICandidate
	err := sqlitex.DB.WithContext(ctx).Where("english = ?", repo.CanonicalEnglish(english)).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return dictionary.Candidate{}, false, nil
	}
	if err != nil {
		return dictionary.Candidate{}, false, err
	}
	return dictionary.Candidate{
		English:       row.English,
		Chinese:       row.Chinese,
		Quality:       row.Quality,
		PromptVersion: row.PromptVersion,
		Status:        dictionary.CandidateStatus(row.Status),
		HitCount:      row.HitCount,
		FirstHitAt:    time.UnixMilli(row.FirstHitAt),
		LastHitAt:     time.UnixMilli(row.LastHitAt),
	}, true, nil
}

// HitCandidate is one atomic UPDATE, so concurrent hits never lose a count.
func (AICandidates) HitCandidate(ctx context.Context, english string) error {
	return sqlitex.DB.WithContext(ctx).Exec(
		`UPDATE ai_candidates SET hit_count = hit_count + 1, last_hit_at = ? WHERE english = ?`,
		time.Now().UnixMilli(), repo.CanonicalEnglish(english)).Error
}

// AddCandidate is one statement: it inserts the row unless words has a live
// row with Chinese for the word, and on a conflict with an existing candidate (pending or
// rejected) it keeps that row's status and definition and only counts a hit.
func (AICandidates) AddCandidate(ctx context.Context, c dictionary.Candidate) (bool, error) {
	now := time.Now().UnixMilli()
	english := repo.CanonicalEnglish(c.English)
	result := sqlitex.DB.WithContext(ctx).Exec(
		`INSERT INTO ai_candidates (english, chinese, quality, prompt_version, status, hit_count, first_hit_at, last_hit_at)
		 SELECT ?, ?, ?, ?, ?, 1, ?, ?
		 WHERE NOT EXISTS (SELECT 1 FROM words WHERE english = ? AND deleted_at IS NULL AND COALESCE(chinese, '') <> '')
		 ON CONFLICT(english) DO UPDATE SET hit_count = hit_count + 1, last_hit_at = excluded.last_hit_at`,
		english, c.Chinese, c.Quality, c.PromptVersion, string(dictionary.CandidatePending), now, now, english)
	return result.RowsAffected > 0, result.Error
}

// AddAIWord is the guarded words write (ADR-091 Decision 9), one transaction
// that reads the candidate's status and writes:
//   - rejected candidate: nothing is written (stored false);
//   - pending candidate: the words row is inserted and the candidate deleted;
//   - no candidate: the words row is inserted;
//   - a live words row already there: its id is returned, and it is filled
//     if it has no Chinese, else left unchanged (either way a pending
//     candidate is deleted).
func (AICandidates) AddAIWord(ctx context.Context, entry dictionary.Entry) (string, bool, error) {
	english := repo.CanonicalEnglish(entry.English)
	var (
		id     string
		stored bool
	)
	err := sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var cand sqlitex.AICandidate
		hasCandidate := true
		if err := tx.Where("english = ?", english).First(&cand).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			hasCandidate = false
		}
		if hasCandidate && cand.Status == string(dictionary.CandidateRejected) {
			return nil
		}

		now := time.Now().UnixMilli()
		quality, version := entry.Quality, entry.PromptVersion
		row := repo.Word{
			Id:              uuid.NewString(),
			English:         english,
			Chinese:         entry.Chinese,
			Pronunciation:   entry.Pronunciation,
			CreatedAt:       now,
			UpdatedAt:       now,
			Source:          repo.WordSourceAI,
			AIQuality:       &quality,
			AIPromptVersion: &version,
		}
		var existing repo.Word
		err := tx.Where("english = ? AND deleted_at IS NULL", english).First(&existing).Error
		switch {
		case err == nil:
			id = existing.Id
			if err := fillEmptyWord(tx, id, row); err != nil {
				return err
			}
		case errors.Is(err, gorm.ErrRecordNotFound):
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			id = row.Id
		default:
			return err
		}
		if hasCandidate {
			if err := tx.Where("english = ?", english).Delete(&sqlitex.AICandidate{}).Error; err != nil {
				return err
			}
		}
		stored = true
		return nil
	})
	if err != nil {
		return "", false, err
	}
	return id, stored, nil
}
