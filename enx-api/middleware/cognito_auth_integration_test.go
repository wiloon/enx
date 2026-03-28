//go:build integration

package middleware

import (
	"enx-api/cognitotest"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func initCognitoIntegrationDB(t *testing.T) {
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

func TestCognitoAuth_ValidTokenProvisionsUser(t *testing.T) {
	initCognitoIntegrationDB(t)
	env := cognitotest.NewEnv(t)

	sub := "integration-middleware-sub-001"
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM users WHERE cognito_sub = ?", sub)
	})
	sqlitex.DB.Exec("DELETE FROM users WHERE cognito_sub = ?", sub)

	token := env.SignAccessToken(t, jwt.MapClaims{
		"sub":   sub,
		"email": "middleware@example.com",
	})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CognitoAuth(CognitoConfig{
		Region:     env.Region,
		UserPoolID: env.UserPoolID,
		ClientIDs:  env.ClientIDs,
		JWKSURL:    env.JWKSURL,
	}))
	r.GET("/api/me", func(c *gin.Context) {
		gotSub, _ := c.Get("cognito_sub")
		if gotSub != sub {
			t.Fatalf("cognito_sub = %v, want %s", gotSub, sub)
		}
		if _, ok := c.Get("user_id"); !ok {
			t.Fatal("expected user_id in context")
		}
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
	}
}

func TestCognitoAuth_GetMeHandler(t *testing.T) {
	initCognitoIntegrationDB(t)
	env := cognitotest.NewEnv(t)

	sub := "integration-getme-sub-001"
	email := "getme@example.com"
	name := "getme-user"
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM users WHERE cognito_sub = ?", sub)
	})
	sqlitex.DB.Exec("DELETE FROM users WHERE cognito_sub = ?", sub)

	token := env.SignAccessToken(t, jwt.MapClaims{
		"sub":              sub,
		"email":            email,
		"cognito:username": name,
	})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CognitoAuth(CognitoConfig{
		Region:     env.Region,
		UserPoolID: env.UserPoolID,
		ClientIDs:  env.ClientIDs,
		JWKSURL:    env.JWKSURL,
	}))
	r.GET("/api/me", getMeHandlerForTest(t))

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
	}

	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["email"] != email {
		t.Fatalf("email = %q, want %q", body["email"], email)
	}
	if body["name"] != name {
		t.Fatalf("name = %q, want %q", body["name"], name)
	}
	if body["status"] != "active" {
		t.Fatalf("status = %q, want active", body["status"])
	}
}

// getMeHandlerForTest mirrors main.GetMe without importing the main package.
func getMeHandlerForTest(t *testing.T) gin.HandlerFunc {
	t.Helper()
	return func(c *gin.Context) {
		userID := GetUserIDFromContext(c)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Unauthorized"})
			return
		}
		var row struct {
			Id     string
			Name   string
			Email  string
			Status string
		}
		if err := sqlitex.DB.Table("users").Where("id = ?", userID).First(&row).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "User not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"id":     row.Id,
			"name":   row.Name,
			"email":  row.Email,
			"status": row.Status,
		})
	}
}
