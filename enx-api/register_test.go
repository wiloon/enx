package main

import (
	"bytes"
	"encoding/json"
	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/utils/sqlitex"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func setupRegisterRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/register", Register)
	return r
}

func cleanupTestUser(t *testing.T, username string) {
	t.Helper()
	var user enx.User
	if err := sqlitex.DB.Where("name = ?", username).First(&user).Error; err == nil {
		sqlitex.DB.Where("user_id = ?", user.Id).Delete(&middleware.Session{})
		sqlitex.DB.Where("name = ?", username).Delete(&enx.User{})
	}
}

func TestRegister_MissingRequiredFields(t *testing.T) {
	r := setupRegisterRouter()

	// missing password and email
	body := []byte(`{"username":"testuser"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/register", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
	var resp RegisterResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Success {
		t.Error("expected success=false")
	}
}

func TestRegister_InvalidEmailFormat(t *testing.T) {
	r := setupRegisterRouter()

	body, _ := json.Marshal(RegisterRequest{
		Username: "testuser",
		Email:    "not-an-email",
		Password: "password123",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/register", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
	var resp RegisterResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Success {
		t.Error("expected success=false")
	}
}

func TestRegister_UsernameAlreadyExists(t *testing.T) {
	username := "test_register_existing"
	cleanupTestUser(t, username)

	// Seed a user with the same username
	existing := &enx.User{
		Name:     username,
		Email:    username + "@test.com",
		Password: "somehash",
		Status:   "active",
	}
	if err := existing.Create(); err != nil {
		t.Fatalf("failed to seed test user: %v", err)
	}
	defer cleanupTestUser(t, username)

	r := setupRegisterRouter()
	body, _ := json.Marshal(RegisterRequest{
		Username: username,
		Email:    "other@test.com",
		Password: "password123",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/register", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
	var resp RegisterResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Success {
		t.Error("expected success=false")
	}
	if resp.Message != "Username already exists" {
		t.Errorf("expected message 'Username already exists', got %q", resp.Message)
	}
}

func TestRegister_Success(t *testing.T) {
	username := "test_register_new_user"
	cleanupTestUser(t, username)
	defer cleanupTestUser(t, username)

	r := setupRegisterRouter()
	body, _ := json.Marshal(RegisterRequest{
		Username: username,
		Email:    username + "@test.com",
		Password: "Password123!",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/register", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d, body: %s", w.Code, w.Body.String())
	}
	var resp RegisterResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if !resp.Success {
		t.Errorf("expected success=true, got message: %s", resp.Message)
	}
	if resp.Status != "pending" {
		t.Errorf("expected status=pending, got %q", resp.Status)
	}
	if resp.User == nil {
		t.Error("expected user in response")
	}
}
