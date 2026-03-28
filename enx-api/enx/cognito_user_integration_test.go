//go:build integration

package enx

import (
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"os"
	"path/filepath"
	"testing"
)

func initCognitoTestDB(t *testing.T) {
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

func cleanupCognitoUser(t *testing.T, sub string) {
	t.Helper()
	sqlitex.DB.Where("cognito_sub = ?", sub).Delete(&User{})
}

func TestGetOrCreateByCognitoSub_CreatesUser(t *testing.T) {
	initCognitoTestDB(t)

	sub := "integration-sub-create-001"
	cleanupCognitoUser(t, sub)
	defer cleanupCognitoUser(t, sub)

	id, err := GetOrCreateByCognitoSub(sub, "newuser@example.com", "newuser")
	if err != nil {
		t.Fatalf("GetOrCreateByCognitoSub: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty user id")
	}

	user := GetUserByCognitoSub(sub)
	if user.Id != id {
		t.Fatalf("user id = %q, want %q", user.Id, id)
	}
	if user.Email != "newuser@example.com" {
		t.Fatalf("email = %q", user.Email)
	}
	if user.Name != "newuser" {
		t.Fatalf("name = %q, want newuser", user.Name)
	}
	if user.Status != "active" {
		t.Fatalf("status = %q, want active", user.Status)
	}
}

func TestGetOrCreateByCognitoSub_Idempotent(t *testing.T) {
	initCognitoTestDB(t)

	sub := "integration-sub-idempotent-002"
	cleanupCognitoUser(t, sub)
	defer cleanupCognitoUser(t, sub)

	firstID, err := GetOrCreateByCognitoSub(sub, "repeat@example.com", "repeat")
	if err != nil {
		t.Fatalf("first call: %v", err)
	}

	secondID, err := GetOrCreateByCognitoSub(sub, "repeat@example.com", "repeat")
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if firstID != secondID {
		t.Fatalf("ids differ: %q vs %q", firstID, secondID)
	}

	var count int64
	sqlitex.DB.Model(&User{}).Where("cognito_sub = ?", sub).Count(&count)
	if count != 1 {
		t.Fatalf("expected 1 user row, got %d", count)
	}
}

func TestGetOrCreateByCognitoSub_NameFromEmail(t *testing.T) {
	initCognitoTestDB(t)

	sub := "integration-sub-emailname-003"
	cleanupCognitoUser(t, sub)
	defer cleanupCognitoUser(t, sub)

	_, err := GetOrCreateByCognitoSub(sub, "derived.name@example.com", "")
	if err != nil {
		t.Fatalf("GetOrCreateByCognitoSub: %v", err)
	}

	user := GetUserByCognitoSub(sub)
	if user.Name != "derived.name" {
		t.Fatalf("name = %q, want derived.name", user.Name)
	}
}

func TestGetOrCreateByCognitoSub_NameFallback(t *testing.T) {
	initCognitoTestDB(t)

	sub := "1234567890abcdef"
	cleanupCognitoUser(t, sub)
	defer cleanupCognitoUser(t, sub)

	_, err := GetOrCreateByCognitoSub(sub, "", "")
	if err != nil {
		t.Fatalf("GetOrCreateByCognitoSub: %v", err)
	}

	user := GetUserByCognitoSub(sub)
	want := "user-" + sub[:8]
	if user.Name != want {
		t.Fatalf("name = %q, want %q", user.Name, want)
	}
}
