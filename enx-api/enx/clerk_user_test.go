package enx

import (
	"testing"
	"time"

	"github.com/spf13/viper"
)

func TestGetOrCreateByClerkUserID_EmptyID(t *testing.T) {
	newUserTestDB(t)

	if _, err := GetOrCreateByClerkUserID("", "a@b.com", "alice"); err == nil {
		t.Fatal("expected an error for an empty clerk user id")
	}
}

func TestGetOrCreateByClerkUserID_ProvisionsNewUser(t *testing.T) {
	newUserTestDB(t)

	id, err := GetOrCreateByClerkUserID("user_abc123", "alice@example.com", "Alice Doe")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id == "" {
		t.Fatal("expected a non-empty user id")
	}

	got := GetUserByClerkUserID("user_abc123")
	if got.Id != id {
		t.Errorf("Id = %q, want %q", got.Id, id)
	}
	if got.Name != "Alice Doe" {
		t.Errorf("Name = %q, want 'Alice Doe'", got.Name)
	}
	if got.Email != "alice@example.com" {
		t.Errorf("Email = %q, want alice@example.com", got.Email)
	}
	if got.Status != "active" {
		t.Errorf("Status = %q, want active", got.Status)
	}
}

func TestGetOrCreateByClerkUserID_NameFromEmailWhenNameEmpty(t *testing.T) {
	newUserTestDB(t)

	id, err := GetOrCreateByClerkUserID("user_noname", "derived.name@example.com", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := GetUserByID(id); got.Name != "derived.name" {
		t.Errorf("Name = %q, want derived.name (from email local-part)", got.Name)
	}
}

func TestGetOrCreateByClerkUserID_FallsBackToIDForName(t *testing.T) {
	newUserTestDB(t)

	id, err := GetOrCreateByClerkUserID("user_xyz789", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got := GetUserByID(id)
	want := "user-" + "user_xyz789"[:8]
	if got.Name != want {
		t.Errorf("Name = %q, want %q (fallback from clerk user id)", got.Name, want)
	}
}

func TestGetOrCreateByClerkUserID_Idempotent(t *testing.T) {
	newUserTestDB(t)
	viper.Set("user.last-login-update-interval", 0)
	defer viper.Set("user.last-login-update-interval", nil)

	first, err := GetOrCreateByClerkUserID("user_existing", "alice@example.com", "Alice")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	before := GetUserByID(first)
	time.Sleep(2 * time.Millisecond)

	second, err := GetOrCreateByClerkUserID("user_existing", "alice@example.com", "Alice")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if second != first {
		t.Fatalf("expected the same user id on a repeat lookup, got %q want %q", second, first)
	}

	after := GetUserByID(first)
	if !after.LastLoginTime.After(before.LastLoginTime) {
		t.Errorf("expected LastLoginTime to advance: before=%v after=%v", before.LastLoginTime, after.LastLoginTime)
	}
}

func TestGetOrCreateByClerkUserID_SkipsLastLoginUpdateWithinInterval(t *testing.T) {
	newUserTestDB(t)
	viper.Set("user.last-login-update-interval", "1h")
	defer viper.Set("user.last-login-update-interval", nil)

	id, err := GetOrCreateByClerkUserID("user_throttled", "bob@example.com", "Bob")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	before := GetUserByID(id)
	time.Sleep(2 * time.Millisecond)

	if _, err := GetOrCreateByClerkUserID("user_throttled", "bob@example.com", "Bob"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	after := GetUserByID(id)
	if !after.LastLoginTime.Equal(before.LastLoginTime) {
		t.Errorf("expected LastLoginTime unchanged within throttle interval: before=%v after=%v", before.LastLoginTime, after.LastLoginTime)
	}
}
