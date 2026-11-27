package adapters

import (
	"time"

	"enx-api/repo"

	"gorm.io/gorm"
)

// fillEmptyWord writes row's definition onto the live words row id, in place,
// if that row has no Chinese (ADR-098 Decision 5). A row with Chinese is left
// unchanged. The condition is part of the UPDATE, so of two concurrent fills
// only the first writes.
func fillEmptyWord(db *gorm.DB, id string, row repo.Word) error {
	return db.Model(&repo.Word{}).
		Where("id = ? AND deleted_at IS NULL AND COALESCE(chinese, '') = ''", id).
		Updates(map[string]any{
			"chinese":           row.Chinese,
			"pronunciation":     row.Pronunciation,
			"source":            row.Source,
			"admin_edited_at":   row.AdminEditedAt,
			"ai_quality":        row.AIQuality,
			"ai_prompt_version": row.AIPromptVersion,
			"updated_at":        time.Now().UnixMilli(),
		}).Error
}
