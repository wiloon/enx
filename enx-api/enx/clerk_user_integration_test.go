//go:build integration

package enx

import (
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"os"
	"path/filepath"
	"testing"
)

func initClerkTestDB(t *testing.T) {
	t.Helper()
	logger.Init("CONSOLE", "debug", "enx-api-test")
	dbPath := filepath.Join(t.TempDir(), "enx-test.db")
	if err := os.Setenv("DB_PATH", dbPath); err != nil {
		t.Fatalf("set DB_PATH: %v", err)
	}
	sqlitex.Init()
	if sqlitex.DB == nil {
		t.Fatal("sqlitex.DB is nil after Init")
	}
}

func cleanupClerkUser(t *testing.T, clerkUserID string) {
	t.Helper()
	sqlitex.DB.Where("clerk_user_id = ?", clerkUserID).Delete(&User{})
}

func TestGetOrCreateByClerkUserID_CreatesUser(t *testing.T) {
	initClerkTestDB(t)

	id := "user_createclerk001"
	cleanupClerkUser(t, id)
	defer cleanupClerkUser(t, id)

	uid, err := GetOrCreateByClerkUserID(id, "newuser@example.com", "New User")
	if err != nil {
		t.Fatalf("GetOrCreateByClerkUserID: %v", err)
	}
	if uid == "" {
		t.Fatal("expected non-empty user id")
	}

	user := GetUserByClerkUserID(id)
	if user.Id != uid {
		t.Fatalf("user id = %q, want %q", user.Id, uid)
	}
	if user.Email != "newuser@example.com" {
		t.Fatalf("email = %q", user.Email)
	}
	if user.Name != "New User" {
		t.Fatalf("name = %q, want 'New User'", user.Name)
	}
	if user.Status != "active" {
		t.Fatalf("status = %q, want active", user.Status)
	}
}

func TestGetOrCreateByClerkUserID_Idempotent(t *testing.T) {
	initClerkTestDB(t)

	id := "user_idempotentclerk002"
	cleanupClerkUser(t, id)
	defer cleanupClerkUser(t, id)

	firstID, err := GetOrCreateByClerkUserID(id, "repeat@example.com", "Repeat")
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	secondID, err := GetOrCreateByClerkUserID(id, "repeat@example.com", "Repeat")
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if firstID != secondID {
		t.Fatalf("ids differ: %q vs %q", firstID, secondID)
	}

	var count int64
	sqlitex.DB.Model(&User{}).Where("clerk_user_id = ?", id).Count(&count)
	if count != 1 {
		t.Fatalf("expected 1 user row, got %d", count)
	}
}

func TestGetOrCreateByClerkUserID_NameFromEmail(t *testing.T) {
	initClerkTestDB(t)

	id := "user_emailnameclerk003"
	cleanupClerkUser(t, id)
	defer cleanupClerkUser(t, id)

	if _, err := GetOrCreateByClerkUserID(id, "derived.name@example.com", ""); err != nil {
		t.Fatalf("GetOrCreateByClerkUserID: %v", err)
	}

	if user := GetUserByClerkUserID(id); user.Name != "derived.name" {
		t.Fatalf("name = %q, want derived.name", user.Name)
	}
}

func TestGetOrCreateByClerkUserID_NameFallback(t *testing.T) {
	initClerkTestDB(t)

	id := "user_fallbackclerk004"
	cleanupClerkUser(t, id)
	defer cleanupClerkUser(t, id)

	if _, err := GetOrCreateByClerkUserID(id, "", ""); err != nil {
		t.Fatalf("GetOrCreateByClerkUserID: %v", err)
	}

	user := GetUserByClerkUserID(id)
	want := "user-" + id[:8]
	if user.Name != want {
		t.Fatalf("name = %q, want %q", user.Name, want)
	}
}
