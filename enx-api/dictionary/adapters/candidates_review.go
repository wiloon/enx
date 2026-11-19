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

// The admin's side of the AI candidate table (ADR-091): list, approve, reject,
// un-reject.

// ListCandidates returns the candidates with the given status, most hit first
// then most recently hit, and the total number with that status.
func (AICandidates) ListCandidates(ctx context.Context, status dictionary.CandidateStatus, limit, offset int) ([]dictionary.Candidate, int64, error) {
	db := sqlitex.DB.WithContext(ctx).Model(&sqlitex.AICandidate{}).Where("status = ?", string(status))
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []sqlitex.AICandidate
	if err := db.Order("hit_count DESC, last_hit_at DESC, english ASC").
		Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	out := make([]dictionary.Candidate, 0, len(rows))
	for _, row := range rows {
		out = append(out, dictionary.Candidate{
			English:       row.English,
			Chinese:       row.Chinese,
			Quality:       row.Quality,
			PromptVersion: row.PromptVersion,
			Status:        dictionary.CandidateStatus(row.Status),
			HitCount:      row.HitCount,
			FirstHitAt:    time.UnixMilli(row.FirstHitAt),
			LastHitAt:     time.UnixMilli(row.LastHitAt),
		})
	}
	return out, total, nil
}

// RejectCandidate marks the candidate rejected.
func (c AICandidates) RejectCandidate(ctx context.Context, english string) error {
	return c.setStatus(ctx, english, dictionary.CandidateRejected)
}

// UnrejectCandidate puts a rejected candidate back to pending.
func (c AICandidates) UnrejectCandidate(ctx context.Context, english string) error {
	return c.setStatus(ctx, english, dictionary.CandidatePending)
}

func (AICandidates) setStatus(ctx context.Context, english string, status dictionary.CandidateStatus) error {
	res := sqlitex.DB.WithContext(ctx).Model(&sqlitex.AICandidate{}).
		Where("english = ?", repo.CanonicalEnglish(english)).Update("status", string(status))
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return dictionary.ErrCandidateNotFound
	}
	return nil
}

// ApproveCandidate moves the candidate into words as an admin-reviewed AI row
// and deletes it, in one transaction. A live words row is left untouched
// (created false); a soft-deleted row is revived and overwritten. Any failure
// rolls everything back.
func (AICandidates) ApproveCandidate(ctx context.Context, english string) (created bool, err error) {
	english = repo.CanonicalEnglish(english)
	err = sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		created = false
		var cand sqlitex.AICandidate
		if err := tx.Where("english = ?", english).First(&cand).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return dictionary.ErrCandidateNotFound
			}
			return err
		}
		// Claim the candidate first: of two concurrent approves only one
		// deletes the row.
		del := tx.Where("english = ?", english).Delete(&sqlitex.AICandidate{})
		if del.Error != nil {
			return del.Error
		}
		if del.RowsAffected == 0 {
			return dictionary.ErrCandidateNotFound
		}

		now := time.Now().UnixMilli()
		quality, version := cand.Quality, cand.PromptVersion
		var existing repo.Word
		err := tx.Where("english = ?", english).First(&existing).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			row := repo.Word{
				Id: uuid.NewString(), English: english, Chinese: cand.Chinese,
				CreatedAt: now, UpdatedAt: now, Source: repo.WordSourceAI,
				AdminEditedAt: &now, AIQuality: &quality, AIPromptVersion: &version,
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			created = true
		case err != nil:
			return err
		case existing.DeletedAt == nil:
			// A live row wins; the candidate has nothing left to add.
		default:
			err := tx.Model(&repo.Word{}).Where("id = ?", existing.Id).Updates(map[string]any{
				"chinese":           cand.Chinese,
				"pronunciation":     "",
				"updated_at":        now,
				"deleted_at":        nil,
				"source":            repo.WordSourceAI,
				"admin_edited_at":   now,
				"ai_quality":        quality,
				"ai_prompt_version": version,
			}).Error
			if err != nil {
				return err
			}
			created = true
		}
		return nil
	})
	if err != nil {
		return false, err
	}
	return created, nil
}
