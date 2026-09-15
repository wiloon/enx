package reader

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"enx-api/utils"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

func TestMain(m *testing.M) {
	dbPath := filepath.Join(os.TempDir(), "enx-reader-document-test.db")
	os.Remove(dbPath)
	os.Setenv("DB_PATH", dbPath)
	utils.ViperInit()
	sqlitex.Init()
	os.Exit(m.Run())
}

func TestCreateDocumentStoresContentWithSevenDayExpiry(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	doc, err := CreateDocument(ctx, userID, "hello world", now)
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}

	if doc.Content != "hello world" {
		t.Fatalf("got content %q, want %q", doc.Content, "hello world")
	}

	wantExpiresAt := now.Add(7 * 24 * time.Hour)
	if diff := doc.ExpiresAt.Sub(wantExpiresAt); diff < -time.Second || diff > time.Second {
		t.Fatalf("got expiresAt %v, want ~%v", doc.ExpiresAt, wantExpiresAt)
	}
}

func TestCreateDocumentRejectsContentOverMaxLength(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	tooLong := make([]byte, MaxContentLength+1)
	for i := range tooLong {
		tooLong[i] = 'a'
	}

	_, err := CreateDocument(ctx, userID, string(tooLong), now)
	if !errors.Is(err, ErrContentTooLong) {
		t.Fatalf("got %v, want ErrContentTooLong", err)
	}
}

func TestCreateDocumentAcceptsContentAtMaxLength(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	atLimit := make([]byte, MaxContentLength)
	for i := range atLimit {
		atLimit[i] = 'a'
	}

	if _, err := CreateDocument(ctx, userID, string(atLimit), now); err != nil {
		t.Fatalf("CreateDocument at exactly MaxContentLength: %v", err)
	}
}

func TestCreateDocumentRejectsEmptyContent(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	if _, err := CreateDocument(ctx, userID, "", now); !errors.Is(err, ErrContentEmpty) {
		t.Fatalf("got %v, want ErrContentEmpty", err)
	}
}

func TestCreateDocumentEvictsOldestWhenOverCap(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	var oldestID string
	for i := 0; i < MaxDocumentsPerUser; i++ {
		doc, err := CreateDocument(ctx, userID, "doc", now.Add(time.Duration(i)*time.Minute))
		if err != nil {
			t.Fatalf("create doc %d: %v", i, err)
		}
		if i == 0 {
			oldestID = doc.ID
		}
	}

	if count := countDocuments(t, userID); count != MaxDocumentsPerUser {
		t.Fatalf("got %d documents after filling to cap, want %d", count, MaxDocumentsPerUser)
	}

	newest, err := CreateDocument(ctx, userID, "doc", now.Add(time.Duration(MaxDocumentsPerUser)*time.Minute))
	if err != nil {
		t.Fatalf("create doc over cap: %v", err)
	}

	if count := countDocuments(t, userID); count != MaxDocumentsPerUser {
		t.Fatalf("got %d documents after exceeding cap, want %d (oldest should be evicted)", count, MaxDocumentsPerUser)
	}
	if documentExists(t, oldestID) {
		t.Fatalf("oldest document %s should have been evicted", oldestID)
	}
	if !documentExists(t, newest.ID) {
		t.Fatalf("newest document %s should still exist", newest.ID)
	}
}

func TestListDocumentsOrdersByCreatedAtDescending(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	first, err := CreateDocument(ctx, userID, "first", now)
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	second, err := CreateDocument(ctx, userID, "second", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("create second: %v", err)
	}
	third, err := CreateDocument(ctx, userID, "third", now.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("create third: %v", err)
	}

	docs, err := ListDocuments(ctx, userID, now.Add(3*time.Minute))
	if err != nil {
		t.Fatalf("ListDocuments: %v", err)
	}

	wantIDs := []string{third.ID, second.ID, first.ID}
	if len(docs) != len(wantIDs) {
		t.Fatalf("got %d documents, want %d", len(docs), len(wantIDs))
	}
	for i, want := range wantIDs {
		if docs[i].ID != want {
			t.Fatalf("docs[%d].ID = %s, want %s", i, docs[i].ID, want)
		}
	}
}

func TestListDocumentsExcludesOtherUsers(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	otherUserID := "other-" + t.Name()
	now := time.Now()

	mine, err := CreateDocument(ctx, userID, "mine", now)
	if err != nil {
		t.Fatalf("create mine: %v", err)
	}
	if _, err := CreateDocument(ctx, otherUserID, "not mine", now); err != nil {
		t.Fatalf("create other user's doc: %v", err)
	}

	docs, err := ListDocuments(ctx, userID, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("ListDocuments: %v", err)
	}
	if len(docs) != 1 || docs[0].ID != mine.ID {
		t.Fatalf("got %+v, want only %s", docs, mine.ID)
	}
}

func TestListDocumentsExcludesExpired(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	expired, err := CreateDocument(ctx, userID, "expired", now)
	if err != nil {
		t.Fatalf("create expired: %v", err)
	}
	fresh, err := CreateDocument(ctx, userID, "fresh", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("create fresh: %v", err)
	}

	// Ask at a point in time after `expired`'s 7-day TTL but before `fresh`'s.
	checkAt := now.Add(7*24*time.Hour + 30*time.Second)

	docs, err := ListDocuments(ctx, userID, checkAt)
	if err != nil {
		t.Fatalf("ListDocuments: %v", err)
	}
	if len(docs) != 1 || docs[0].ID != fresh.ID {
		t.Fatalf("got %+v, want only fresh doc %s (expired doc %s should be excluded)", docs, fresh.ID, expired.ID)
	}
}

func TestGetDocumentReturnsFullContent(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	created, err := CreateDocument(ctx, userID, "full article text", now)
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}

	got, err := GetDocument(ctx, userID, created.ID, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("GetDocument: %v", err)
	}
	if got.Content != "full article text" {
		t.Fatalf("got content %q, want %q", got.Content, "full article text")
	}
}

func TestGetDocumentRejectsWrongOwner(t *testing.T) {
	ctx := context.Background()
	ownerID := "u-" + t.Name()
	attackerID := "attacker-" + t.Name()
	now := time.Now()

	created, err := CreateDocument(ctx, ownerID, "private", now)
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}

	if _, err := GetDocument(ctx, attackerID, created.ID, now.Add(time.Minute)); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("got %v, want gorm.ErrRecordNotFound", err)
	}
}

func TestGetDocumentRejectsExpired(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	created, err := CreateDocument(ctx, userID, "will expire", now)
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}

	checkAt := now.Add(7*24*time.Hour + 30*time.Second)
	if _, err := GetDocument(ctx, userID, created.ID, checkAt); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("got %v, want gorm.ErrRecordNotFound", err)
	}
}

func TestDeleteDocumentRemovesIt(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	now := time.Now()

	created, err := CreateDocument(ctx, userID, "to delete", now)
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}

	if err := DeleteDocument(ctx, userID, created.ID); err != nil {
		t.Fatalf("DeleteDocument: %v", err)
	}

	if documentExists(t, created.ID) {
		t.Fatalf("document %s should have been deleted", created.ID)
	}
}

func TestDeleteDocumentDoesNotAffectOtherUsersDocument(t *testing.T) {
	ctx := context.Background()
	ownerID := "u-" + t.Name()
	attackerID := "attacker-" + t.Name()
	now := time.Now()

	created, err := CreateDocument(ctx, ownerID, "not yours", now)
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}

	if err := DeleteDocument(ctx, attackerID, created.ID); err != nil {
		t.Fatalf("DeleteDocument (attacker, should be a silent no-op): %v", err)
	}

	if !documentExists(t, created.ID) {
		t.Fatalf("document %s should NOT have been deleted by a non-owner", created.ID)
	}
}

func TestPurgeExpiredDeletesOnlyExpiredAcrossUsers(t *testing.T) {
	ctx := context.Background()
	userA := "u-" + t.Name() + "-a"
	userB := "u-" + t.Name() + "-b"
	now := time.Now()

	expiredA, err := CreateDocument(ctx, userA, "expired a", now)
	if err != nil {
		t.Fatalf("create expiredA: %v", err)
	}
	expiredB, err := CreateDocument(ctx, userB, "expired b", now)
	if err != nil {
		t.Fatalf("create expiredB: %v", err)
	}
	fresh, err := CreateDocument(ctx, userA, "fresh", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("create fresh: %v", err)
	}

	// Other tests in this package share the same DB and may have left their
	// own expired rows behind by the time this runs, so assert a lower bound
	// (our 2 rows must be included) rather than an exact count.
	purgeAt := now.Add(7*24*time.Hour + 30*time.Second)
	deleted, err := PurgeExpired(ctx, purgeAt)
	if err != nil {
		t.Fatalf("PurgeExpired: %v", err)
	}
	if deleted < 2 {
		t.Fatalf("got deleted=%d, want at least 2", deleted)
	}

	if documentExists(t, expiredA.ID) {
		t.Fatalf("expiredA %s should have been purged", expiredA.ID)
	}
	if documentExists(t, expiredB.ID) {
		t.Fatalf("expiredB %s should have been purged", expiredB.ID)
	}
	if !documentExists(t, fresh.ID) {
		t.Fatalf("fresh %s should NOT have been purged", fresh.ID)
	}
}

func countDocuments(t *testing.T, userID string) int64 {
	t.Helper()
	var count int64
	if err := sqlitex.DB.Model(&sqlitex.ReaderDocument{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		t.Fatalf("count reader_documents: %v", err)
	}
	return count
}

func documentExists(t *testing.T, id string) bool {
	t.Helper()
	var count int64
	if err := sqlitex.DB.Model(&sqlitex.ReaderDocument{}).Where("id = ?", id).Count(&count).Error; err != nil {
		t.Fatalf("check reader_documents existence: %v", err)
	}
	return count > 0
}
