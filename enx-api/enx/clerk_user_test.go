package enx

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestGetOrCreateByClerkUserID_EmptyID(t *testing.T) {
	newUserTestDB(t)

	if _, err := GetOrCreateByClerkUserID("", "a@b.com", "alice", time.Nanosecond); err == nil {
		t.Fatal("expected an error for an empty clerk user id")
	}
}

func TestGetOrCreateByClerkUserID_ProvisionsNewUser(t *testing.T) {
	newUserTestDB(t)

	id, err := GetOrCreateByClerkUserID("user_abc123", "alice@example.com", "Alice Doe", time.Nanosecond)
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

	id, err := GetOrCreateByClerkUserID("user_noname", "derived.name@example.com", "", time.Nanosecond)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := GetUserByID(id); got.Name != "derived.name" {
		t.Errorf("Name = %q, want derived.name (from email local-part)", got.Name)
	}
}

func TestGetOrCreateByClerkUserID_FallsBackToIDForName(t *testing.T) {
	newUserTestDB(t)

	id, err := GetOrCreateByClerkUserID("user_xyz789", "", "", time.Nanosecond)
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

	first, err := GetOrCreateByClerkUserID("user_existing", "alice@example.com", "Alice", time.Nanosecond)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	before := GetUserByID(first)
	time.Sleep(2 * time.Millisecond)

	second, err := GetOrCreateByClerkUserID("user_existing", "alice@example.com", "Alice", time.Nanosecond)
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

	id, err := GetOrCreateByClerkUserID("user_throttled", "bob@example.com", "Bob", time.Hour)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	before := GetUserByID(id)
	time.Sleep(2 * time.Millisecond)

	if _, err := GetOrCreateByClerkUserID("user_throttled", "bob@example.com", "Bob", time.Hour); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	after := GetUserByID(id)
	if !after.LastLoginTime.Equal(before.LastLoginTime) {
		t.Errorf("expected LastLoginTime unchanged within throttle interval: before=%v after=%v", before.LastLoginTime, after.LastLoginTime)
	}
}

type recordingHook struct {
	userIDs []string
	err     error
}

func (h *recordingHook) NewUser(_ context.Context, userID string) error {
	h.userIDs = append(h.userIDs, userID)
	return h.err
}

func withNewUserHook(t *testing.T, h NewUserHook) {
	t.Helper()
	SetNewUserHook(h)
	t.Cleanup(func() { SetNewUserHook(nil) })
}

// The new-user hook (ADR-048 Decision 3) fires once, when the account is
// created, and not on later sign-ins.
func TestGetOrCreateByClerkUserID_NewUserHookFiresOnlyOnCreate(t *testing.T) {
	newUserTestDB(t)
	hook := &recordingHook{}
	withNewUserHook(t, hook)

	id, err := GetOrCreateByClerkUserID("user_hook1", "h@example.com", "H", time.Nanosecond)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := GetOrCreateByClerkUserID("user_hook1", "h@example.com", "H", time.Nanosecond); err != nil {
		t.Fatal(err)
	}

	if len(hook.userIDs) != 1 || hook.userIDs[0] != id {
		t.Fatalf("hook calls = %v, want exactly [%s]", hook.userIDs, id)
	}
}

// A failing hook (e.g. the trial grant) must not fail the sign-in.
func TestGetOrCreateByClerkUserID_FailingHookDoesNotFailSignIn(t *testing.T) {
	newUserTestDB(t)
	withNewUserHook(t, &recordingHook{err: errors.New("ledger down")})

	id, err := GetOrCreateByClerkUserID("user_hook2", "", "", time.Nanosecond)
	if err != nil || id == "" {
		t.Fatalf("got id=%q err=%v, want a provisioned user", id, err)
	}
}
