package saving

import (
	"context"
	"strings"
	"testing"
	"time"
)

type memoryDocuments struct{ current *Document }

func (m *memoryDocuments) Change(_ context.Context, _ string, _ int, change func(*Document) (*Document, error)) (*Document, error) {
	next, err := change(m.current)
	if err == nil {
		m.current = next
	}
	return next, err
}

const documentID = "9c14d6dd-9d0e-42c9-92b7-c8786a43d909"

var savedAt = time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)

func TestOlderSaveCannotOverwriteNewerContent(t *testing.T) {
	store := &memoryDocuments{}
	service := NewSaveService(store)
	if _, err := service.Save(context.Background(), "owner", documentID, "newer", 2, savedAt); err != nil {
		t.Fatal(err)
	}
	doc, err := service.Save(context.Background(), "owner", documentID, "older", 1, savedAt.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if doc.Version != 2 || doc.Content != "newer" || !doc.ExpiresAt.Equal(savedAt.Add(RetentionPeriod)) {
		t.Fatalf("older save changed document: %+v", doc)
	}
}

func TestRetryDoesNotExtendRetention(t *testing.T) {
	store := &memoryDocuments{}
	service := NewSaveService(store)
	if _, err := service.Save(context.Background(), "owner", documentID, "same", 1, savedAt); err != nil {
		t.Fatal(err)
	}
	doc, err := service.Save(context.Background(), "owner", documentID, "same", 1, savedAt.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if !doc.UpdatedAt.Equal(savedAt) || !doc.ExpiresAt.Equal(savedAt.Add(RetentionPeriod)) {
		t.Fatalf("retry extended retention: %+v", doc)
	}
}

func TestSameVersionDifferentContentConflicts(t *testing.T) {
	store := &memoryDocuments{}
	service := NewSaveService(store)
	if _, err := service.Save(context.Background(), "owner", documentID, "first tab", 1, savedAt); err != nil {
		t.Fatal(err)
	}
	_, err := service.Save(context.Background(), "owner", documentID, "second tab", 1, savedAt.Add(time.Hour))
	if err != ErrVersionConflict {
		t.Fatalf("got %v, want edit conflict", err)
	}
	if store.current.Content != "first tab" {
		t.Fatalf("conflict changed content: %+v", store.current)
	}
}

func TestHigherVersionUpdatesWithoutChangingIdentity(t *testing.T) {
	store := &memoryDocuments{}
	service := NewSaveService(store)
	original, err := service.Save(context.Background(), "owner", documentID, "original", 1, savedAt)
	if err != nil {
		t.Fatal(err)
	}
	now := savedAt.Add(time.Hour)
	doc, err := service.Save(context.Background(), "owner", documentID, "edited", 2, now)
	if err != nil {
		t.Fatal(err)
	}
	if doc.ID != original.ID || !doc.CreatedAt.Equal(original.CreatedAt) || doc.Version != 2 || doc.Content != "edited" || !doc.ExpiresAt.Equal(now.Add(RetentionPeriod)) {
		t.Fatalf("incorrect edit: %+v", doc)
	}
}

func TestSaveCannotTakeAnotherUsersUUID(t *testing.T) {
	store := &memoryDocuments{}
	service := NewSaveService(store)
	if _, err := service.Save(context.Background(), "owner", documentID, "private", 1, savedAt); err != nil {
		t.Fatal(err)
	}
	_, err := service.Save(context.Background(), "other", documentID, "overwrite", 9, savedAt.Add(time.Hour))
	if err != ErrDocumentUnavailable {
		t.Fatalf("got %v, want unavailable", err)
	}
	if store.current.Content != "private" || store.current.UserID != "owner" {
		t.Fatalf("ownership changed: %+v", store.current)
	}
}

func TestSaveCannotReviveExpiredDocument(t *testing.T) {
	store := &memoryDocuments{}
	service := NewSaveService(store)
	if _, err := service.Save(context.Background(), "owner", documentID, "expired", 1, savedAt); err != nil {
		t.Fatal(err)
	}
	_, err := service.Save(context.Background(), "owner", documentID, "revived", 2, savedAt.Add(RetentionPeriod))
	if err != ErrDocumentUnavailable {
		t.Fatalf("got %v, want unavailable", err)
	}
	if store.current.Content != "expired" {
		t.Fatal("revived expired document")
	}
}

func TestInvalidSavesNeverReachStorage(t *testing.T) {
	cases := []struct {
		name, id, content string
		version           int64
		want              error
	}{
		{"invalid UUID", "not-a-uuid", "text", 1, ErrInvalidSave},
		{"zero version", documentID, "text", 0, ErrInvalidSave},
		{"negative version", documentID, "text", -1, ErrInvalidSave},
		{"unsafe JS version", documentID, "text", 9007199254740992, ErrInvalidSave},
		{"empty content", documentID, "", 1, ErrContentEmpty},
		{"over limit", documentID, strings.Repeat("a", MaxContentLength+1), 1, ErrContentTooLong},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &memoryDocuments{}
			_, err := NewSaveService(store).Save(context.Background(), "owner", tc.id, tc.content, tc.version, savedAt)
			if err != tc.want || store.current != nil {
				t.Fatalf("err=%v stored=%+v", err, store.current)
			}
		})
	}
}

func TestContentLimitUsesBrowserUTF16Length(t *testing.T) {
	service := NewSaveService(&memoryDocuments{})
	if _, err := service.Save(context.Background(), "owner", documentID, strings.Repeat("😀", 10000), 1, savedAt); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Save(context.Background(), "owner", documentID, strings.Repeat("😀", 10001), 2, savedAt); err != ErrContentTooLong {
		t.Fatalf("got %v", err)
	}
}
