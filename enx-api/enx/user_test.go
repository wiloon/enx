package enx

import (
	"testing"
	"time"

	"enx-api/utils/password"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"github.com/spf13/viper"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func newUserTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&User{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
	return db
}

func createTestUser(t *testing.T, name, plainPassword string) *User {
	t.Helper()
	hashed, err := password.HashPassword(plainPassword)
	if err != nil {
		t.Fatalf("failed to hash password: %v", err)
	}
	u := &User{Name: name, Email: name + "@example.com", Password: hashed, Status: "active"}
	if err := u.Create(); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	return u
}

func TestUserCreateAssignsIDAndTimestamps(t *testing.T) {
	newUserTestDB(t)

	u := &User{Name: "alice", Email: "alice@example.com"}
	if err := u.Create(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if u.Id == "" {
		t.Error("expected Create to assign an Id")
	}
	if u.CreateTime.IsZero() {
		t.Error("expected Create to set CreateTime")
	}
}

func TestUserCreateKeepsExplicitID(t *testing.T) {
	newUserTestDB(t)

	u := &User{Id: "explicit-id", Name: "bob"}
	if err := u.Create(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if u.Id != "explicit-id" {
		t.Errorf("Id = %q, want explicit-id", u.Id)
	}
}

func TestUserLoginSuccess(t *testing.T) {
	newUserTestDB(t)
	createTestUser(t, "alice", "hunter2")

	u := &User{Name: "alice", Password: "hunter2"}
	if !u.Login() {
		t.Fatal("expected login to succeed with the correct password")
	}
	if u.Id == "" {
		t.Error("expected Login to populate Id on success")
	}
	if u.Status != "active" {
		t.Errorf("Status = %q, want active", u.Status)
	}
}

func TestUserLoginWrongPassword(t *testing.T) {
	newUserTestDB(t)
	createTestUser(t, "alice", "hunter2")

	u := &User{Name: "alice", Password: "wrong-password"}
	if u.Login() {
		t.Error("expected login to fail with an incorrect password")
	}
}

func TestUserLoginUnknownUser(t *testing.T) {
	newUserTestDB(t)

	u := &User{Name: "nobody", Password: "whatever"}
	if u.Login() {
		t.Error("expected login to fail for a user that doesn't exist")
	}
}

func TestGeUserByName(t *testing.T) {
	newUserTestDB(t)
	createTestUser(t, "alice", "hunter2")

	got := GeUserByName("alice")
	if got.Id == "" {
		t.Fatal("expected to find alice")
	}

	got = GeUserByName("missing")
	if got.Id != "" {
		t.Error("expected an empty user for a name that doesn't exist")
	}
}

func TestGetUserByEmail(t *testing.T) {
	newUserTestDB(t)
	u := createTestUser(t, "alice", "hunter2")

	got := GetUserByEmail(u.Email)
	if got.Id != u.Id {
		t.Errorf("Id = %q, want %q", got.Id, u.Id)
	}

	got = GetUserByEmail("missing@example.com")
	if got.Id != "" {
		t.Error("expected an empty user for an email that doesn't exist")
	}
}

func TestGetUserByID(t *testing.T) {
	newUserTestDB(t)
	u := createTestUser(t, "alice", "hunter2")

	got := GetUserByID(u.Id)
	if got.Name != "alice" {
		t.Errorf("Name = %q, want alice", got.Name)
	}

	got = GetUserByID("missing-id")
	if got.Id != "" {
		t.Error("expected an empty user for an id that doesn't exist")
	}
}

func TestGetUserByVerificationToken(t *testing.T) {
	newUserTestDB(t)
	u := createTestUser(t, "alice", "hunter2")
	if err := u.SetVerificationToken("tok-123", time.Now().Add(48*time.Hour)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got := GetUserByVerificationToken("tok-123")
	if got.Id != u.Id {
		t.Errorf("Id = %q, want %q", got.Id, u.Id)
	}

	got = GetUserByVerificationToken("missing-token")
	if got.Id != "" {
		t.Error("expected an empty user for a token that doesn't exist")
	}
}

func TestGetUserByResetToken(t *testing.T) {
	newUserTestDB(t)
	u := createTestUser(t, "alice", "hunter2")
	if err := u.SetResetToken("reset-123", time.Now().Add(1*time.Hour)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got := GetUserByResetToken("reset-123")
	if got.Id != u.Id {
		t.Errorf("Id = %q, want %q", got.Id, u.Id)
	}

	got = GetUserByResetToken("missing-token")
	if got.Id != "" {
		t.Error("expected an empty user for a token that doesn't exist")
	}
}

func TestGetUserByCognitoSub(t *testing.T) {
	newUserTestDB(t)
	u := &User{Name: "alice", CognitoSub: "sub-123"}
	if err := u.Create(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got := GetUserByCognitoSub("sub-123")
	if got.Id != u.Id {
		t.Errorf("Id = %q, want %q", got.Id, u.Id)
	}

	got = GetUserByCognitoSub("missing-sub")
	if got.Id != "" {
		t.Error("expected an empty user for a cognito sub that doesn't exist")
	}
}

func TestUserActivateClearsVerificationToken(t *testing.T) {
	newUserTestDB(t)
	u := createTestUser(t, "alice", "hunter2")
	u.Status = "pending"
	if err := u.SetVerificationToken("tok-123", time.Now().Add(48*time.Hour)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if err := u.Activate(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	reloaded := GetUserByID(u.Id)
	if reloaded.Status != "active" {
		t.Errorf("Status = %q, want active", reloaded.Status)
	}
	if reloaded.VerificationToken != "" {
		t.Errorf("VerificationToken = %q, want empty", reloaded.VerificationToken)
	}
}

func TestUserUpdatePasswordClearsResetToken(t *testing.T) {
	newUserTestDB(t)
	u := createTestUser(t, "alice", "old-password")
	if err := u.SetResetToken("reset-123", time.Now().Add(1*time.Hour)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if err := u.UpdatePassword("new-password"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	reloaded := GetUserByID(u.Id)
	if reloaded.ResetToken != "" {
		t.Errorf("ResetToken = %q, want empty", reloaded.ResetToken)
	}

	login := &User{Name: "alice", Password: "new-password"}
	if !login.Login() {
		t.Error("expected login with the new password to succeed")
	}
	loginOld := &User{Name: "alice", Password: "old-password"}
	if loginOld.Login() {
		t.Error("expected login with the old password to fail")
	}
}

func TestGenerateTokenIsUniqueAndHexEncoded(t *testing.T) {
	tok1, err := GenerateToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	tok2, err := GenerateToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(tok1) != 64 { // 32 bytes hex-encoded
		t.Errorf("len(tok1) = %d, want 64", len(tok1))
	}
	if tok1 == tok2 {
		t.Error("expected two calls to GenerateToken to produce different tokens")
	}
}

func TestGetOrCreateByCognitoSubEmptySub(t *testing.T) {
	newUserTestDB(t)

	_, err := GetOrCreateByCognitoSub("", "a@b.com", "alice")
	if err == nil {
		t.Fatal("expected an error for an empty cognito sub")
	}
}

func TestGetOrCreateByCognitoSubProvisionsNewUser(t *testing.T) {
	newUserTestDB(t)

	id, err := GetOrCreateByCognitoSub("sub-abc123", "alice@example.com", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id == "" {
		t.Fatal("expected a non-empty user id")
	}

	got := GetUserByCognitoSub("sub-abc123")
	if got.Name != "alice" {
		t.Errorf("Name = %q, want alice (derived from email)", got.Name)
	}
	if got.Status != "active" {
		t.Errorf("Status = %q, want active", got.Status)
	}
}

func TestGetOrCreateByCognitoSubFallsBackToSubForName(t *testing.T) {
	newUserTestDB(t)

	id, err := GetOrCreateByCognitoSub("sub-xyz789", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got := GetUserByID(id)
	want := "user-" + "sub-xyz789"[:8]
	if got.Name != want {
		t.Errorf("Name = %q, want %q (fallback derived from sub)", got.Name, want)
	}
}

func TestGetOrCreateByCognitoSubUpdatesLastLoginForExistingUser(t *testing.T) {
	newUserTestDB(t)
	viper.Set("user.last-login-update-interval", 0)
	defer viper.Set("user.last-login-update-interval", nil)

	id, err := GetOrCreateByCognitoSub("sub-existing", "alice@example.com", "alice")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	before := GetUserByID(id)
	time.Sleep(2 * time.Millisecond)

	gotID, err := GetOrCreateByCognitoSub("sub-existing", "alice@example.com", "alice")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotID != id {
		t.Fatalf("expected the same user id on a repeat lookup, got %q want %q", gotID, id)
	}

	after := GetUserByID(id)
	if !after.LastLoginTime.After(before.LastLoginTime) {
		t.Errorf("expected LastLoginTime to advance: before=%v after=%v", before.LastLoginTime, after.LastLoginTime)
	}
}

func TestGetOrCreateByCognitoSubSkipsLastLoginUpdateWithinInterval(t *testing.T) {
	newUserTestDB(t)
	viper.Set("user.last-login-update-interval", "1h")
	defer viper.Set("user.last-login-update-interval", nil)

	id, err := GetOrCreateByCognitoSub("sub-throttled", "bob@example.com", "bob")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	before := GetUserByID(id)
	time.Sleep(2 * time.Millisecond)

	if _, err := GetOrCreateByCognitoSub("sub-throttled", "bob@example.com", "bob"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	after := GetUserByID(id)
	if !after.LastLoginTime.Equal(before.LastLoginTime) {
		t.Errorf("expected LastLoginTime to stay unchanged within the throttle interval: before=%v after=%v", before.LastLoginTime, after.LastLoginTime)
	}
}
