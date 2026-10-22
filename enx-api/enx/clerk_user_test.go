package enx

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"

	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestGetOrCreateByClerkUserID_EmptyID(t *testing.T) {
	newUserTestDB(t)

	if _, err := GetOrCreateByClerkUserID("", ClerkProfile{Email: "a@b.com", Name: "alice"}, time.Nanosecond); err == nil {
		t.Fatal("expected an error for an empty clerk user id")
	}
}

func TestGetOrCreateByClerkUserID_ProvisionsNewUser(t *testing.T) {
	newUserTestDB(t)

	id, err := GetOrCreateByClerkUserID("user_abc123", ClerkProfile{Email: "alice@example.com", Name: "Alice Doe"}, time.Nanosecond)
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

	id, err := GetOrCreateByClerkUserID("user_noname", ClerkProfile{Email: "derived.name@example.com", Name: ""}, time.Nanosecond)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := GetUserByID(id); got.Name != "derived.name" {
		t.Errorf("Name = %q, want derived.name (from email local-part)", got.Name)
	}
}

func TestGetOrCreateByClerkUserID_Idempotent(t *testing.T) {
	newUserTestDB(t)

	first, err := GetOrCreateByClerkUserID("user_existing", ClerkProfile{Email: "alice@example.com", Name: "Alice"}, time.Nanosecond)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	before := GetUserByID(first)
	time.Sleep(2 * time.Millisecond)

	second, err := GetOrCreateByClerkUserID("user_existing", ClerkProfile{Email: "alice@example.com", Name: "Alice"}, time.Nanosecond)
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

	id, err := GetOrCreateByClerkUserID("user_throttled", ClerkProfile{Email: "bob@example.com", Name: "Bob"}, time.Hour)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	before := GetUserByID(id)
	time.Sleep(2 * time.Millisecond)

	if _, err := GetOrCreateByClerkUserID("user_throttled", ClerkProfile{Email: "bob@example.com", Name: "Bob"}, time.Hour); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	after := GetUserByID(id)
	if !after.LastLoginTime.Equal(before.LastLoginTime) {
		t.Errorf("expected LastLoginTime unchanged within throttle interval: before=%v after=%v", before.LastLoginTime, after.LastLoginTime)
	}
}

// The middleware reads the status from the same lookup to reject a disabled
// account (ADR-062 Decision 5).
func TestGetOrCreateClerkUser_ReturnsTheStatus(t *testing.T) {
	newUserTestDB(t)

	u, err := GetOrCreateClerkUser("user_status", ClerkProfile{Email: "s@example.com", Name: "S"}, time.Nanosecond)
	if err != nil || u.Status != "active" {
		t.Fatalf("new user = %+v, %v; want status active", u, err)
	}
	if err := GetUserByID(u.Id).SetStatus("disabled"); err != nil {
		t.Fatal(err)
	}
	again, err := GetOrCreateClerkUser("user_status", ClerkProfile{Email: "s@example.com", Name: "S"}, time.Nanosecond)
	if err != nil || again.Id != u.Id || again.Status != "disabled" {
		t.Fatalf("existing user = %+v, %v; want %s disabled", again, err, u.Id)
	}
}

type recordingHook struct {
	userIDs []string
	emails  []string
	err     error
}

func (h *recordingHook) NewUser(_ context.Context, userID, email string) error {
	h.userIDs = append(h.userIDs, userID)
	h.emails = append(h.emails, email)
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

	id, err := GetOrCreateByClerkUserID("user_hook1", ClerkProfile{Email: "h@example.com", Name: "H"}, time.Nanosecond)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := GetOrCreateByClerkUserID("user_hook1", ClerkProfile{Email: "h@example.com", Name: "H"}, time.Nanosecond); err != nil {
		t.Fatal(err)
	}

	if len(hook.userIDs) != 1 || hook.userIDs[0] != id {
		t.Fatalf("hook calls = %v, want exactly [%s]", hook.userIDs, id)
	}
	if hook.emails[0] != "h@example.com" {
		t.Fatalf("hook email = %q, want the token's email", hook.emails[0])
	}
}

// A failing hook (e.g. the trial grant) must not fail the sign-in.
func TestGetOrCreateByClerkUserID_FailingHookDoesNotFailSignIn(t *testing.T) {
	newUserTestDB(t)
	withNewUserHook(t, &recordingHook{err: errors.New("ledger down")})

	id, err := GetOrCreateByClerkUserID("user_hook2", ClerkProfile{Email: "hook2@example.com"}, time.Nanosecond)
	if err != nil || id == "" {
		t.Fatalf("got id=%q err=%v, want a provisioned user", id, err)
	}
}

// countUserWrites makes the test database count every UPDATE of users.
func countUserWrites(t *testing.T) func() int64 {
	t.Helper()
	db := sqlitex.DB
	for _, stmt := range []string{
		`CREATE TABLE user_writes (n INTEGER)`,
		`CREATE TRIGGER count_user_writes AFTER UPDATE ON users BEGIN INSERT INTO user_writes VALUES (1); END`,
	} {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	return func() int64 {
		var n int64
		if err := db.Raw(`SELECT count(*) FROM user_writes`).Scan(&n).Error; err != nil {
			t.Fatal(err)
		}
		return n
	}
}

func provision(t *testing.T, clerkUserID string, p ClerkProfile) *User {
	t.Helper()
	u, err := GetOrCreateClerkUser(clerkUserID, p, time.Hour)
	if err != nil {
		t.Fatalf("provision %s: %v", clerkUserID, err)
	}
	return u
}

// ADR-015 2026-10-20 note §2: a changed email, name or image URL in the token
// is written on the next request, whatever the last-login throttle says.
func TestGetOrCreateClerkUser_SyncsAChangedProfile(t *testing.T) {
	newUserTestDB(t)
	u := provision(t, "user_sync", ClerkProfile{Email: "old@example.com", Name: "Old", ImageURL: "https://img/old.png"})

	got, err := GetOrCreateClerkUser("user_sync", ClerkProfile{Email: "New@Example.com", Name: "New Name", ImageURL: "https://img/new.png"}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	stored := GetUserByID(u.Id)
	if stored.Email != "New@Example.com" || stored.Name != "New Name" || stored.AvatarUrl != "https://img/new.png" {
		t.Fatalf("stored = %q %q %q, want the token's new profile", stored.Email, stored.Name, stored.AvatarUrl)
	}
	if got.Email != stored.Email || got.Name != stored.Name || got.AvatarUrl != stored.AvatarUrl {
		t.Fatalf("returned = %q %q %q, want what was stored", got.Email, got.Name, got.AvatarUrl)
	}
}

func TestGetOrCreateClerkUser_EmptyClaimsLeaveTheStoredProfile(t *testing.T) {
	newUserTestDB(t)
	u := provision(t, "user_keep", ClerkProfile{Email: "keep@example.com", Name: "Keep", ImageURL: "https://img/keep.png"})
	writes := countUserWrites(t)

	got, err := GetOrCreateClerkUser("user_keep", ClerkProfile{Email: "  ", Name: "", ImageURL: " "}, time.Hour)
	if err != nil {
		t.Fatalf("existing user with empty claims: %v", err)
	}

	stored := GetUserByID(u.Id)
	if stored.Email != "keep@example.com" || stored.Name != "Keep" || stored.AvatarUrl != "https://img/keep.png" {
		t.Fatalf("stored = %q %q %q, want the profile untouched", stored.Email, stored.Name, stored.AvatarUrl)
	}
	if got.Id != u.Id || writes() != 0 {
		t.Fatalf("got user %s with %d writes, want %s and no write", got.Id, writes(), u.Id)
	}
}

func TestGetOrCreateClerkUser_UnchangedProfileCausesNoWrite(t *testing.T) {
	newUserTestDB(t)
	p := ClerkProfile{Email: "same@example.com", Name: "Same", ImageURL: "https://img/same.png"}
	provision(t, "user_same", p)
	writes := countUserWrites(t)

	provision(t, "user_same", ClerkProfile{Email: " same@example.com ", Name: "Same", ImageURL: "https://img/same.png"})

	if n := writes(); n != 0 {
		t.Fatalf("%d writes for an unchanged profile, want none", n)
	}
}

// Users are identified by Clerk User ID only (ADR-015 2026-10-20 note §4).
func TestGetOrCreateClerkUser_SyncsAnEmailAnotherRowAlreadyHas(t *testing.T) {
	newUserTestDB(t)
	provision(t, "user_stale", ClerkProfile{Email: "shared@example.com", Name: "Stale"})
	u := provision(t, "user_mover", ClerkProfile{Email: "mover@example.com", Name: "Mover"})

	provision(t, "user_mover", ClerkProfile{Email: "shared@example.com", Name: "Mover"})

	if got := GetUserByID(u.Id).Email; got != "shared@example.com" {
		t.Fatalf("email = %q, want shared@example.com", got)
	}
}

func TestGetOrCreateClerkUser_NewClerkIDWithAKnownEmailGetsANewUser(t *testing.T) {
	newUserTestDB(t)
	old := provision(t, "user_old", ClerkProfile{Email: "dup@example.com", Name: "Old", ImageURL: "https://img/old.png"})

	fresh := provision(t, "user_new", ClerkProfile{Email: "dup@example.com", Name: "Fresh"})

	if fresh.Id == old.Id {
		t.Fatal("a new Clerk user id reused the old row")
	}
	kept := GetUserByID(old.Id)
	if kept.ClerkUserID != "user_old" || kept.Email != "dup@example.com" || kept.Name != "Old" || kept.AvatarUrl != "https://img/old.png" {
		t.Fatalf("old row = %+v, want it untouched", kept)
	}
}

// ADR-015 2026-10-20 note §3: no user without an email.
func TestGetOrCreateClerkUser_RefusesANewUserWithoutAnEmail(t *testing.T) {
	newUserTestDB(t)
	hook := &recordingHook{}
	withNewUserHook(t, hook)

	for _, email := range []string{"", "   "} {
		if _, err := GetOrCreateClerkUser("user_noemail", ClerkProfile{Email: email, Name: "N"}, time.Hour); !errors.Is(err, ErrNoEmail) {
			t.Fatalf("email %q: err = %v, want ErrNoEmail", email, err)
		}
	}
	var n int64
	sqlitex.DB.Raw(`SELECT count(*) FROM users`).Scan(&n)
	if n != 0 || len(hook.userIDs) != 0 {
		t.Fatalf("%d users and %d hook calls, want none", n, len(hook.userIDs))
	}
}

func TestGetOrCreateClerkUser_StoresANewUsersTrimmedEmailAndAvatar(t *testing.T) {
	newUserTestDB(t)
	hook := &recordingHook{}
	withNewUserHook(t, hook)

	u := provision(t, "user_trim", ClerkProfile{Email: "  Trim.Me@Example.com\t", Name: "Trim", ImageURL: "https://img/trim.png"})

	stored := GetUserByID(u.Id)
	if stored.Email != "Trim.Me@Example.com" || stored.AvatarUrl != "https://img/trim.png" {
		t.Fatalf("stored = %q %q, want the trimmed email and the avatar", stored.Email, stored.AvatarUrl)
	}
	if len(hook.emails) != 1 || hook.emails[0] != "Trim.Me@Example.com" {
		t.Fatalf("hook emails = %v, want the trimmed email", hook.emails)
	}
}

func TestGetOrCreateClerkUser_SyncStoresATrimmedEmail(t *testing.T) {
	newUserTestDB(t)
	u := provision(t, "user_trim2", ClerkProfile{Email: "a@example.com", Name: "A"})

	provision(t, "user_trim2", ClerkProfile{Email: " b@example.com  ", Name: "A"})

	if got := GetUserByID(u.Id).Email; got != "b@example.com" {
		t.Fatalf("email = %q, want b@example.com", got)
	}
}

// A failed sync write is logged and retried on the next request; the user
// still gets in with the stored profile, and a disabled account stays
// disabled.
func TestGetOrCreateClerkUser_SyncWriteFailureKeepsTheStoredProfile(t *testing.T) {
	newUserTestDB(t)
	u := provision(t, "user_fail", ClerkProfile{Email: "stored@example.com", Name: "Stored"})
	if err := GetUserByID(u.Id).SetStatus("disabled"); err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec(`CREATE TRIGGER refuse_profile BEFORE UPDATE OF email ON users BEGIN SELECT RAISE(ABORT, 'disk full'); END`).Error; err != nil {
		t.Fatal(err)
	}
	core, logs := observer.New(zap.DebugLevel)
	t.Cleanup(logger.Swap(zap.New(core).Sugar()))

	got, err := GetOrCreateClerkUser("user_fail", ClerkProfile{Email: "secret-new@example.com", Name: "Secret New"}, time.Hour)
	if err != nil {
		t.Fatalf("sync failure failed the sign-in: %v", err)
	}
	if got.Id != u.Id || got.Email != "stored@example.com" || got.Name != "Stored" || got.Status != "disabled" {
		t.Fatalf("returned %+v, want the stored, disabled profile", got)
	}
	errs := logs.FilterLevelExact(zap.ErrorLevel).All()
	if len(errs) != 1 || !strings.Contains(errs[0].Message, u.Id) || !strings.Contains(errs[0].Message, "disk full") {
		t.Fatalf("error logs = %+v, want one naming the user id and the database error", errs)
	}
	if strings.Contains(errs[0].Message, "secret-new") || strings.Contains(errs[0].Message, "Secret New") {
		t.Fatalf("log %q carries profile values", errs[0].Message)
	}

	if err := sqlitex.DB.Exec(`DROP TRIGGER refuse_profile`).Error; err != nil {
		t.Fatal(err)
	}
	provision(t, "user_fail", ClerkProfile{Email: "secret-new@example.com", Name: "Secret New"})
	if stored := GetUserByID(u.Id); stored.Email != "secret-new@example.com" || stored.Name != "Secret New" {
		t.Fatalf("retry stored %q %q, want the new profile", stored.Email, stored.Name)
	}
}
