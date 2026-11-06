package repo

import (
	"context"
	"errors"
	"time"

	"enx-api/reader/saving"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

type ReaderDocuments struct{ DB *gorm.DB }

func (r ReaderDocuments) Change(ctx context.Context, id string, limit int, change func(*saving.Document) (*saving.Document, error)) (*saving.Document, error) {
	var result *saving.Document
	err := r.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Acquire SQLite's writer lock before reading, including for a missing ID.
		if err := tx.Exec("UPDATE reader_documents SET version = version WHERE id = ?", id).Error; err != nil {
			return err
		}
		var row sqlitex.ReaderDocument
		err := tx.First(&row, "id = ?", id).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var current *saving.Document
		if err == nil {
			current = &saving.Document{ID: row.ID, UserID: row.UserID, Content: row.Content, Version: row.Version, CreatedAt: time.UnixMilli(row.CreatedAt), UpdatedAt: time.UnixMilli(row.LastEditedAt), ExpiresAt: time.UnixMilli(row.ExpiresAt)}
		}
		result, err = change(current)
		if err != nil {
			return err
		}
		if result == current {
			return nil
		}
		if current == nil {
			var count int64
			if err := tx.Model(&sqlitex.ReaderDocument{}).Where("user_id = ?", result.UserID).Count(&count).Error; err != nil {
				return err
			}
			if count >= int64(limit) {
				if err := tx.Exec("DELETE FROM reader_documents WHERE id IN (SELECT id FROM reader_documents WHERE user_id = ? ORDER BY created_at, id LIMIT ?)", result.UserID, count-int64(limit)+1).Error; err != nil {
					return err
				}
			}
		}
		row = sqlitex.ReaderDocument{ID: result.ID, UserID: result.UserID, Content: result.Content, Version: result.Version, CreatedAt: result.CreatedAt.UnixMilli(), LastEditedAt: result.UpdatedAt.UnixMilli(), ExpiresAt: result.ExpiresAt.UnixMilli()}
		if current == nil {
			return tx.Create(&row).Error
		}
		return tx.Model(&sqlitex.ReaderDocument{}).Where("id = ?", id).Updates(map[string]any{"content": row.Content, "version": row.Version, "updated_at": row.LastEditedAt, "expires_at": row.ExpiresAt}).Error
	})
	return result, err
}
