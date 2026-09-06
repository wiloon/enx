package middleware

import (
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

func newSessionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&Session{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
	return db
}

func TestGetUserIDFromContextPresent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "u1")

	if got := GetUserIDFromContext(c); got != "u1" {
		t.Errorf("got %q, want u1", got)
	}
}

func TestGetUserIDFromContextAbsent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	if got := GetUserIDFromContext(c); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func setupSessionRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(SessionMiddleware())
	r.Any("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"user_id": GetUserIDFromContext(c)})
	})
	return r
}

func TestSessionMiddlewareSkipsOptions(t *testing.T) {
	newSessionTestDB(t)
	r := setupSessionRouter()

	req := httptest.NewRequest(http.MethodOptions, "/protected", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected OPTIONS to pass through with status 200, got %d", w.Code)
	}
}

func TestSessionMiddlewareNoSessionID(t *testing.T) {
	newSessionTestDB(t)
	r := setupSessionRouter()

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 with no session id, got %d", w.Code)
	}
}

func TestSessionMiddlewareInvalidSessionID(t *testing.T) {
	newSessionTestDB(t)
	r := setupSessionRouter()

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("X-Session-ID", "does-not-exist")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for an unknown session id, got %d", w.Code)
	}
}

func TestSessionMiddlewareExpiredSessionID(t *testing.T) {
	db := newSessionTestDB(t)
	past := time.Now().Add(-1 * time.Hour).UnixMilli()
	if err := db.Create(&Session{ID: "expired-session", UserID: "u1", CreatedAt: past, ExpiresAt: past}).Error; err != nil {
		t.Fatal(err)
	}
	r := setupSessionRouter()

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("X-Session-ID", "expired-session")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for an expired session, got %d", w.Code)
	}
}

func TestSessionMiddlewareValidSessionIDFromHeader(t *testing.T) {
	db := newSessionTestDB(t)
	future := time.Now().Add(1 * time.Hour).UnixMilli()
	if err := db.Create(&Session{ID: "valid-session", UserID: "u1", CreatedAt: time.Now().UnixMilli(), ExpiresAt: future}).Error; err != nil {
		t.Fatal(err)
	}
	r := setupSessionRouter()

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("X-Session-ID", "valid-session")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for a valid session, got %d, body: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"user_id":"u1"`) {
		t.Errorf("expected body to contain user_id u1, got %s", w.Body.String())
	}
}

func TestSessionMiddlewareValidSessionIDFromCookie(t *testing.T) {
	db := newSessionTestDB(t)
	future := time.Now().Add(1 * time.Hour).UnixMilli()
	if err := db.Create(&Session{ID: "cookie-session", UserID: "u2", CreatedAt: time.Now().UnixMilli(), ExpiresAt: future}).Error; err != nil {
		t.Fatal(err)
	}
	r := setupSessionRouter()

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.AddCookie(&http.Cookie{Name: "session_id", Value: "cookie-session"})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for a valid cookie session, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestCreateAndDeleteSession(t *testing.T) {
	db := newSessionTestDB(t)

	session, err := CreateSession("u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if session.ID == "" {
		t.Fatal("expected a non-empty session id")
	}
	if session.UserID != "u1" {
		t.Errorf("UserID = %q, want u1", session.UserID)
	}

	var count int64
	db.Model(&Session{}).Where("id = ?", session.ID).Count(&count)
	if count != 1 {
		t.Fatalf("expected the session to be persisted, count=%d", count)
	}

	if err := DeleteSession(session.ID); err != nil {
		t.Fatalf("unexpected error deleting session: %v", err)
	}
	db.Model(&Session{}).Where("id = ?", session.ID).Count(&count)
	if count != 0 {
		t.Errorf("expected the session to be deleted, count=%d", count)
	}
}

func TestCreateSessionGeneratesUniqueIDs(t *testing.T) {
	newSessionTestDB(t)

	s1, err := CreateSession("u1")
	if err != nil {
		t.Fatal(err)
	}
	s2, err := CreateSession("u1")
	if err != nil {
		t.Fatal(err)
	}
	if s1.ID == s2.ID {
		t.Error("expected two sessions to have different generated IDs")
	}
}
