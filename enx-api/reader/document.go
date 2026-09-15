// Package reader implements storage for enx-ui Reader's pasted-text
// documents: a 20,000-character-per-document limit, a 7-day retention TTL,
// and a 50-document-per-user cap that evicts the oldest document on write.
// See docs/architecture/adr-022-enx-ui-reader-persistence-and-retention.md.
package reader

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"enx-api/utils/sqlitex"
)

const retentionPeriod = 7 * 24 * time.Hour

// MaxContentLength is the per-document character limit (ADR-022 Option C).
const MaxContentLength = 20000

// ErrContentTooLong is returned when content exceeds MaxContentLength.
var ErrContentTooLong = errors.New("reader: content exceeds maximum length")

// ErrContentEmpty is returned when content is empty.
var ErrContentEmpty = errors.New("reader: content is empty")

// MaxDocumentsPerUser is the per-user document cap (ADR-022 Option D). The
// oldest document is evicted on write once a user is at the cap.
const MaxDocumentsPerUser = 50

// Document is a user's pasted-text reader document.
type Document struct {
	ID        string
	UserID    string
	Content   string
	CreatedAt time.Time
	ExpiresAt time.Time
}

// CreateDocument stores content for userID and returns the created document,
// expiring retentionPeriod (7 days) after now.
func CreateDocument(ctx context.Context, userID, content string, now time.Time) (*Document, error) {
	if content == "" {
		return nil, ErrContentEmpty
	}
	if len(content) > MaxContentLength {
		return nil, ErrContentTooLong
	}

	if err := evictOldestIfAtCap(ctx, userID); err != nil {
		return nil, err
	}

	row := sqlitex.ReaderDocument{
		ID:        uuid.NewString(),
		UserID:    userID,
		Content:   content,
		CreatedAt: now.UnixMilli(),
		ExpiresAt: now.Add(retentionPeriod).UnixMilli(),
	}

	if err := sqlitex.DB.WithContext(ctx).Create(&row).Error; err != nil {
		return nil, err
	}

	return &Document{
		ID:        row.ID,
		UserID:    row.UserID,
		Content:   row.Content,
		CreatedAt: time.UnixMilli(row.CreatedAt),
		ExpiresAt: time.UnixMilli(row.ExpiresAt),
	}, nil
}

// DocumentSummary is the lightweight listing view of a Document.
type DocumentSummary struct {
	ID        string
	CreatedAt time.Time
}

// ListDocuments returns userID's non-expired documents, newest first.
func ListDocuments(ctx context.Context, userID string, now time.Time) ([]DocumentSummary, error) {
	var rows []sqlitex.ReaderDocument
	if err := sqlitex.DB.WithContext(ctx).
		Where("user_id = ? AND expires_at > ?", userID, now.UnixMilli()).
		Order("created_at DESC").
		Find(&rows).Error; err != nil {
		return nil, err
	}

	summaries := make([]DocumentSummary, len(rows))
	for i, row := range rows {
		summaries[i] = DocumentSummary{
			ID:        row.ID,
			CreatedAt: time.UnixMilli(row.CreatedAt),
		}
	}
	return summaries, nil
}

// GetDocument returns userID's document id if it exists, belongs to userID,
// and has not expired. Otherwise it returns gorm.ErrRecordNotFound.
func GetDocument(ctx context.Context, userID, id string, now time.Time) (*Document, error) {
	var row sqlitex.ReaderDocument
	if err := sqlitex.DB.WithContext(ctx).
		Where("id = ? AND user_id = ? AND expires_at > ?", id, userID, now.UnixMilli()).
		First(&row).Error; err != nil {
		return nil, err
	}

	return &Document{
		ID:        row.ID,
		UserID:    row.UserID,
		Content:   row.Content,
		CreatedAt: time.UnixMilli(row.CreatedAt),
		ExpiresAt: time.UnixMilli(row.ExpiresAt),
	}, nil
}

// DeleteDocument deletes userID's document id. It is a no-op if the document
// does not exist or does not belong to userID.
func DeleteDocument(ctx context.Context, userID, id string) error {
	return sqlitex.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Delete(&sqlitex.ReaderDocument{}, "id = ?", id).Error
}

// PurgeExpired physically deletes every document across all users whose TTL
// has passed as of now, and returns how many rows were deleted. Called
// periodically by the cleanup goroutine (ADR-022 Option A1).
func PurgeExpired(ctx context.Context, now time.Time) (int64, error) {
	res := sqlitex.DB.WithContext(ctx).
		Where("expires_at < ?", now.UnixMilli()).
		Delete(&sqlitex.ReaderDocument{})
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}

// evictOldestIfAtCap deletes userID's oldest document when they are already
// at MaxDocumentsPerUser, making room for the document about to be created.
func evictOldestIfAtCap(ctx context.Context, userID string) error {
	var count int64
	if err := sqlitex.DB.WithContext(ctx).Model(&sqlitex.ReaderDocument{}).
		Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return err
	}
	if count < MaxDocumentsPerUser {
		return nil
	}

	var oldest sqlitex.ReaderDocument
	if err := sqlitex.DB.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at ASC").
		Limit(1).
		Find(&oldest).Error; err != nil {
		return err
	}
	if oldest.ID == "" {
		return nil
	}

	return sqlitex.DB.WithContext(ctx).Delete(&sqlitex.ReaderDocument{}, "id = ?", oldest.ID).Error
}
