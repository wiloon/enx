package saving

import (
	"context"
	"errors"
	"time"
	"unicode/utf16"

	"github.com/google/uuid"
)

var (
	ErrDocumentUnavailable = errors.New("document not found")
	ErrVersionConflict     = errors.New("reader: document version conflict")
	ErrInvalidSave         = errors.New("invalid document UUID or version")
)

// DocumentStore applies a change under an exclusive transaction. A nil current
// document means this ID has never been saved. Returning the current pointer
// leaves storage and retention unchanged. New rows enforce the supplied cap.
type DocumentStore interface {
	Change(context.Context, string, int, func(*Document) (*Document, error)) (*Document, error)
}

type SaveService struct{ store DocumentStore }

func NewSaveService(store DocumentStore) *SaveService { return &SaveService{store: store} }

func (s *SaveService) Save(ctx context.Context, userID, id, content string, version int64, now time.Time) (*Document, error) {
	parsed, err := uuid.Parse(id)
	if err != nil || parsed.String() != id || version < 1 || version > 9007199254740991 {
		return nil, ErrInvalidSave
	}
	if content == "" {
		return nil, ErrContentEmpty
	}
	if ContentLength(content) > MaxContentLength {
		return nil, ErrContentTooLong
	}
	return s.store.Change(ctx, id, MaxDocumentsPerUser, func(current *Document) (*Document, error) {
		createdAt := now
		if current != nil {
			if current.UserID != userID || !current.ExpiresAt.After(now) {
				return nil, ErrDocumentUnavailable
			}
			if version == current.Version && content != current.Content {
				return nil, ErrVersionConflict
			}
			if version <= current.Version {
				return current, nil
			}
			createdAt = current.CreatedAt
		}
		return &Document{ID: id, UserID: userID, Content: content, Version: version, CreatedAt: createdAt, UpdatedAt: now, ExpiresAt: now.Add(RetentionPeriod)}, nil
	})
}

const RetentionPeriod = 7 * 24 * time.Hour
const MaxDocumentsPerUser = 50
const MaxContentLength = 20000

var ErrContentEmpty = errors.New("reader: content is empty")
var ErrContentTooLong = errors.New("reader: content exceeds maximum length")

type Document struct {
	ID        string
	UserID    string
	Content   string
	Version   int64
	CreatedAt time.Time
	UpdatedAt time.Time
	ExpiresAt time.Time
}

func ContentLength(content string) int {
	n := 0
	for _, r := range content {
		n += utf16.RuneLen(r)
	}
	return n
}
