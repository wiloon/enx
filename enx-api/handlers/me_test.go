package handlers

import (
	"encoding/json"
	"enx-api/middleware"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func setupUsersDB(t *testing.T) {
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
	sqlitex.DB = db
}

func getMe(userID, clerkUserID string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/me", nil)
	if userID != "" {
		c.Set("user_id", userID)
	}
	c.Set("clerk_user_id", clerkUserID)
	GetMe(middleware.NewAdminAllowlist([]string{"user_admin"}))(c)
	return w
}

func TestGetMe(t *testing.T) {
	setupUsersDB(t)
	if err := sqlitex.DB.Create(&sqlitex.User{Id: "u1", ClerkUserID: "user_admin", Name: "Ann", Email: "ann@example.com", Status: "active"}).Error; err != nil {
		t.Fatal(err)
	}

	if w := getMe("", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("no user in context: status %d, want 401", w.Code)
	}
	if w := getMe("u-missing", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("unknown user: status %d, want 401", w.Code)
	}

	for _, tc := range []struct {
		clerkID string
		admin   bool
	}{{"user_admin", true}, {"user_other", false}} {
		w := getMe("u1", tc.clerkID)
		var body map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if w.Code != http.StatusOK || body["id"] != "u1" || body["email"] != "ann@example.com" || body["isAdmin"] != tc.admin {
			t.Fatalf("clerk %s: status %d body %+v, want 200 with isAdmin %v", tc.clerkID, w.Code, body, tc.admin)
		}
	}
}

// #211: the account menu and /account read the join date and avatar from
// /api/me, never from the Clerk session; the Clerk user id stays out.
func TestGetMe_ReturnsJoinDateAndAvatarButNoClerkID(t *testing.T) {
	setupUsersDB(t)
	joined := time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)
	if err := sqlitex.DB.Create(&sqlitex.User{
		Id: "u1", ClerkUserID: "user_secret", Name: "Ann", Email: "ann@example.com", Status: "active",
		AvatarUrl: "https://img.clerk.com/ann.png", CreatedAt: joined,
	}).Error; err != nil {
		t.Fatal(err)
	}

	w := getMe("u1", "user_secret")
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusOK || body["avatarUrl"] != "https://img.clerk.com/ann.png" {
		t.Fatalf("status %d body %+v, want 200 with the avatar URL", w.Code, body)
	}
	created, _ := body["createdAt"].(string)
	if at, err := time.Parse(time.RFC3339, created); err != nil || !at.Equal(joined) {
		t.Fatalf("createdAt = %q, want %s", created, joined.Format(time.RFC3339))
	}
	if strings.Contains(w.Body.String(), "user_secret") {
		t.Fatalf("body carries the Clerk user id: %s", w.Body.String())
	}
}

func TestPing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	Ping(c)
	if w.Code != http.StatusOK || w.Body.String() != `{"message":"pong"}` {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
}
