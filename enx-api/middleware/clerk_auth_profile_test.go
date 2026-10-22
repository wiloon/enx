package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func newUsersDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&sqlitex.User{}); err != nil {
		t.Fatal(err)
	}
	prev := sqlitex.DB
	sqlitex.DB = db
	t.Cleanup(func() { sqlitex.DB = prev })
}

func countUsers(t *testing.T) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Model(&sqlitex.User{}).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

// ADR-015 2026-10-20 note §3: a token for an unknown user without an email
// is refused with 403 email_required (not 401, which clients read as an
// expired session), creates no user, is logged and has its own outcome.
func TestClerkAuth_NewUserWithoutEmailIsRefused(t *testing.T) {
	newUsersDB(t)
	env, cfg := testClerkEnv(t)
	core, logs := observer.New(zap.DebugLevel)
	t.Cleanup(logger.Swap(zap.New(core).Sugar()))
	token := env.SignSessionToken(t, jwt.MapClaims{"sub": "user_noemail", "name": "No Email"})

	obs := &recordedAuth{}
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/me", nil)
	c.Request.Header.Set("Authorization", "Bearer "+token)
	ClerkAuth(cfg, obs)(c)

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusForbidden || body["success"] != false || body["code"] != "email_required" ||
		body["message"] != "Your account has no email address. Please contact support." {
		t.Fatalf("status %d body %+v, want 403 email_required", w.Code, body)
	}
	if !c.IsAborted() {
		t.Fatal("request was not aborted")
	}
	if n := countUsers(t); n != 0 {
		t.Fatalf("%d users created, want none", n)
	}
	if len(obs.outcomes) != 1 || obs.outcomes[0] != "email_required" {
		t.Fatalf("outcomes %v, want [email_required]", obs.outcomes)
	}
	errs := logs.FilterLevelExact(zap.ErrorLevel).All()
	if len(errs) != 1 || !strings.Contains(errs[0].Message, "user_noemail") {
		t.Fatalf("error logs %+v, want one naming the Clerk user id", errs)
	}
}

func TestClerkAuth_ExistingUserWithoutEmailClaimGetsThrough(t *testing.T) {
	newUsersDB(t)
	env, cfg := testClerkEnv(t)
	if err := sqlitex.DB.Create(&sqlitex.User{Id: "u1", ClerkUserID: "user_known", Name: "Known", Email: "known@example.com", Status: "active"}).Error; err != nil {
		t.Fatal(err)
	}
	token := env.SignSessionToken(t, jwt.MapClaims{"sub": "user_known"})

	w := runClerkAuth(t, cfg, "Bearer "+token)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s, want the request let through", w.Code, w.Body.String())
	}
	var u sqlitex.User
	if err := sqlitex.DB.First(&u, "id = ?", "u1").Error; err != nil || u.Email != "known@example.com" {
		t.Fatalf("stored user %+v (%v), want the email kept", u, err)
	}
}

// The image_url claim (ADR-015 2026-10-20 note §1) lands in users.avatar_url.
func TestClerkAuth_StoresTheImageURLClaim(t *testing.T) {
	newUsersDB(t)
	env, cfg := testClerkEnv(t)
	token := env.SignSessionToken(t, jwt.MapClaims{
		"sub": "user_avatar", "email": "avatar@example.com", "name": "Ava", "image_url": "https://img.clerk.com/ava.png",
	})

	if w := runClerkAuth(t, cfg, "Bearer "+token); w.Code != http.StatusOK {
		t.Fatalf("status %d body %s, want 200", w.Code, w.Body.String())
	}
	var u sqlitex.User
	if err := sqlitex.DB.First(&u, "clerk_user_id = ?", "user_avatar").Error; err != nil || u.AvatarUrl != "https://img.clerk.com/ava.png" {
		t.Fatalf("stored user %+v (%v), want the avatar URL", u, err)
	}
}
