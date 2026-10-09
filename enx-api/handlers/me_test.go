package handlers

import (
	"encoding/json"
	"enx-api/middleware"
	"net/http"
	"net/http/httptest"
	"testing"

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

func TestPing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	Ping(c)
	if w.Code != http.StatusOK || w.Body.String() != `{"message":"pong"}` {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
}
