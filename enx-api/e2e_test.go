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

// e2eServer creates a real httptest.Server backed by the full application router.
// The returned cleanup function must be called when the test is done.
func e2eServer(t *testing.T) (*httptest.Server, func()) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := setupRouter()
	ts := httptest.NewServer(router)
	return ts, func() { ts.Close() }
}

// e2eCleanup removes a test user and all their sessions by username.
func e2eCleanup(t *testing.T, username string) {
	t.Helper()
	var user enx.User
	if err := sqlitex.DB.Where("name = ?", username).First(&user).Error; err == nil {
		sqlitex.DB.Where("user_id = ?", user.Id).Delete(&middleware.Session{})
		sqlitex.DB.Where("name = ?", username).Delete(&enx.User{})
	}
}

// TestE2E_RegisterLoginMeLogout exercises the full happy-path user journey:
// register → login → GET /api/me → logout → GET /api/me (expect 401).
func TestE2E_RegisterLoginMeLogout(t *testing.T) {
	ts, done := e2eServer(t)
	defer done()

	username := "e2e_journey_user"
	email := username + "@test.com"
	password := "Password123!"

	e2eCleanup(t, username)
	defer e2eCleanup(t, username)

	client := ts.Client()

	// --- Step 1: Register -------------------------------------------------
	regBody, _ := json.Marshal(map[string]string{
		"username": username,
		"email":    email,
		"password": password,
	})
	regResp, err := client.Post(ts.URL+"/api/register", "application/json", bytes.NewBuffer(regBody))
	if err != nil {
		t.Fatalf("register request failed: %v", err)
	}
	defer regResp.Body.Close()

	if regResp.StatusCode != http.StatusOK {
		t.Fatalf("expected register 200, got %d", regResp.StatusCode)
	}
	var regJSON RegisterResponse
	json.NewDecoder(regResp.Body).Decode(&regJSON)
	if !regJSON.Success {
		t.Fatalf("expected register success=true, message: %s", regJSON.Message)
	}
	if regJSON.Status != "pending" {
		t.Errorf("expected status=pending after register, got %q", regJSON.Status)
	}

	// Manually activate the user so login works without email verification.
	sqlitex.DB.Model(&enx.User{}).Where("name = ?", username).Update("status", "active")

	// --- Step 2: Login ----------------------------------------------------
	loginBody, _ := json.Marshal(map[string]string{
		"username": username,
		"password": password,
	})
	loginResp, err := client.Post(ts.URL+"/api/login", "application/json", bytes.NewBuffer(loginBody))
	if err != nil {
		t.Fatalf("login request failed: %v", err)
	}
	defer loginResp.Body.Close()

	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("expected login 200, got %d", loginResp.StatusCode)
	}
	var loginJSON LoginResponse
	json.NewDecoder(loginResp.Body).Decode(&loginJSON)
	if !loginJSON.Success {
		t.Fatalf("expected login success=true, message: %s", loginJSON.Message)
	}
	sessionID := loginJSON.SessionID
	if sessionID == "" {
		t.Fatal("expected a session_id in login response")
	}

	// --- Step 3: GET /api/me with session ---------------------------------
	meReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/me", nil)
	meReq.Header.Set("X-Session-ID", sessionID)
	meResp, err := client.Do(meReq)
	if err != nil {
		t.Fatalf("GET /api/me request failed: %v", err)
	}
	defer meResp.Body.Close()

	if meResp.StatusCode != http.StatusOK {
		t.Fatalf("expected GET /api/me 200, got %d", meResp.StatusCode)
	}
	var meJSON map[string]interface{}
	json.NewDecoder(meResp.Body).Decode(&meJSON)
	if meJSON["name"] != username {
		t.Errorf("expected name=%q in /api/me, got %v", username, meJSON["name"])
	}
	if meJSON["email"] != email {
		t.Errorf("expected email=%q in /api/me, got %v", email, meJSON["email"])
	}

	// --- Step 4: Logout ---------------------------------------------------
	logoutReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/logout", nil)
	logoutReq.Header.Set("X-Session-ID", sessionID)
	logoutResp, err := client.Do(logoutReq)
	if err != nil {
		t.Fatalf("logout request failed: %v", err)
	}
	defer logoutResp.Body.Close()

	if logoutResp.StatusCode != http.StatusOK {
		t.Errorf("expected logout 200, got %d", logoutResp.StatusCode)
	}

	// --- Step 5: GET /api/me after logout must return 401 -----------------
	meAfterReq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/me", nil)
	meAfterReq.Header.Set("X-Session-ID", sessionID)
	meAfterResp, err := client.Do(meAfterReq)
	if err != nil {
		t.Fatalf("GET /api/me after logout failed: %v", err)
	}
	defer meAfterResp.Body.Close()

	if meAfterResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 after logout, got %d", meAfterResp.StatusCode)
	}
}

// TestE2E_VerifyEmail registers a user, obtains the verification token from the
// DB, calls GET /api/verify-email?token=..., and confirms the account is active.
func TestE2E_VerifyEmail(t *testing.T) {
	ts, done := e2eServer(t)
	defer done()

	username := "e2e_verify_email_user"
	email := username + "@test.com"

	e2eCleanup(t, username)
	defer e2eCleanup(t, username)

	client := ts.Client()

	// Register
	regBody, _ := json.Marshal(map[string]string{
		"username": username,
		"email":    email,
		"password": "Password123!",
	})
	regResp, err := client.Post(ts.URL+"/api/register", "application/json", bytes.NewBuffer(regBody))
	if err != nil {
		t.Fatalf("register request failed: %v", err)
	}
	defer regResp.Body.Close()

	if regResp.StatusCode != http.StatusOK {
		t.Fatalf("expected register 200, got %d", regResp.StatusCode)
	}

	// Fetch the verification token from the DB
	var user enx.User
	if err := sqlitex.DB.Where("name = ?", username).First(&user).Error; err != nil {
		t.Fatalf("user not found in DB after register: %v", err)
	}
	if user.VerificationToken == "" {
		t.Fatal("expected a non-empty verification token in DB")
	}
	if user.Status != "pending" {
		t.Errorf("expected status=pending before verify, got %q", user.Status)
	}

	// Call verify-email endpoint
	verifyResp, err := client.Get(ts.URL + "/api/verify-email?token=" + user.VerificationToken)
	if err != nil {
		t.Fatalf("verify-email request failed: %v", err)
	}
	defer verifyResp.Body.Close()

	if verifyResp.StatusCode != http.StatusOK {
		t.Fatalf("expected verify-email 200, got %d", verifyResp.StatusCode)
	}

	// Confirm the user is now active in the DB
	var updated enx.User
	sqlitex.DB.Where("name = ?", username).First(&updated)
	if updated.Status != "active" {
		t.Errorf("expected status=active after verify-email, got %q", updated.Status)
	}
}

// TestE2E_UnauthenticatedAccessRejected verifies that protected endpoints
// return 401 when no valid session is provided.
func TestE2E_UnauthenticatedAccessRejected(t *testing.T) {
	ts, done := e2eServer(t)
	defer done()

	client := ts.Client()

	endpoints := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/me"},
		{http.MethodGet, "/api/paragraph-init"},
	}

	for _, ep := range endpoints {
		req, _ := http.NewRequest(ep.method, ts.URL+ep.path, nil)
		// Deliberately omit X-Session-ID header
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("%s %s request failed: %v", ep.method, ep.path, err)
		}
		resp.Body.Close()

		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s: expected 401, got %d", ep.method, ep.path, resp.StatusCode)
		}
	}
}

// TestE2E_VerifyEmail_InvalidToken ensures a bogus token returns 400.
func TestE2E_VerifyEmail_InvalidToken(t *testing.T) {
	ts, done := e2eServer(t)
	defer done()

	resp, err := ts.Client().Get(ts.URL + "/api/verify-email?token=definitely-not-a-real-token")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid token, got %d", resp.StatusCode)
	}
}

// TestE2E_VerifyEmail_MissingToken ensures the endpoint rejects a request with no token.
func TestE2E_VerifyEmail_MissingToken(t *testing.T) {
	ts, done := e2eServer(t)
	defer done()

	resp, err := ts.Client().Get(ts.URL + "/api/verify-email")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 when token param is missing, got %d", resp.StatusCode)
	}
}

// TestE2E_LoginInvalidCredentials verifies that bad credentials produce 401.
func TestE2E_LoginInvalidCredentials(t *testing.T) {
	ts, done := e2eServer(t)
	defer done()

	body, _ := json.Marshal(map[string]string{
		"username": "nonexistent_user_xyz",
		"password": "wrongpassword",
	})
	resp, err := ts.Client().Post(ts.URL+"/api/login", "application/json", bytes.NewBuffer(body))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 for invalid credentials, got %d", resp.StatusCode)
	}
}

// setupE2EServerWithRecorder is used for lightweight handler-level assertions
// without spawning a real TCP server.
func setupE2EServerWithRecorder(method, path string, body []byte, headers map[string]string) (*httptest.ResponseRecorder, error) {
	gin.SetMode(gin.TestMode)
	router := setupRouter()
	var req *http.Request
	if body != nil {
		req = httptest.NewRequest(method, path, bytes.NewBuffer(body))
	} else {
		req = httptest.NewRequest(method, path, nil)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w, nil
}
