package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"sync"
	"testing"

	"enx-api/account"
	accountadapters "enx-api/account/adapters"
	"enx-api/clerktest"
	"enx-api/config"
	"enx-api/metrics"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// ADR-062 end to end: account deletion, disabling, signing out, and one
// trial per email.

// fakeClerkBackend stands in for the Clerk Backend API and records each call
// as "METHOD /path".
type fakeClerkBackend struct {
	mu    sync.Mutex
	calls []string
}

func (f *fakeClerkBackend) recorded() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.calls)
}

func (f *fakeClerkBackend) client(t *testing.T) account.Clerk {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.calls = append(f.calls, r.Method+" "+r.URL.Path)
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet && r.URL.Path == "/v1/sessions" {
			_, _ = w.Write([]byte(`[{"id":"sess_1"}]`))
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(server.Close)
	c := accountadapters.NewClerk("sk_test_e2e")
	c.BaseURL = server.URL + "/v1"
	c.HTTP = server.Client()
	return c
}

// accountEnv is a full server with the trial on, the email HMAC key set and
// Clerk's Backend API faked. sign mints a session token for any Clerk user.
type accountEnv struct {
	base  string
	clerk *fakeClerkBackend
	sign  func(sub, email string) string
}

const accountPlainEmail = "plain@example.com"

func newAccountEnv(t *testing.T) *accountEnv {
	t.Helper()
	jwks := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Credits.Trial.Amount = 100
	cfg.Account.EmailHMACKey = "e2e-hmac-key"
	cfg.Clerk = jwks.Config()
	cfg.Admin.ClerkUserIDs = []string{adminSub}

	sqlitex.Init(filepath.Join(t.TempDir(), "enx-account.db"))
	if sqlitex.DB == nil {
		t.Fatal("sqlitex.DB is nil after Init")
	}

	e := &accountEnv{clerk: &fakeClerkBackend{}}
	gin.SetMode(gin.TestMode)
	ts := httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), nil, e.clerk.client(t)))
	t.Cleanup(ts.Close)
	e.base = ts.URL
	e.sign = func(sub, email string) string {
		return jwks.SignSessionToken(t, jwt.MapClaims{"sub": sub, "email": email})
	}
	return e
}

func (e *accountEnv) userID(t *testing.T, sub string) string {
	t.Helper()
	var u sqlitex.User
	if err := sqlitex.DB.Where("clerk_user_id = ?", sub).First(&u).Error; err != nil {
		t.Fatalf("load user %s: %v", sub, err)
	}
	return u.Id
}

func trialBalance(t *testing.T, base, token string) any {
	t.Helper()
	code, body := doJSON(t, http.MethodGet, base+"/api/billing/me", token)
	if code != http.StatusOK {
		t.Fatalf("billing/me: status %d body %+v", code, body)
	}
	credits, _ := body["credits"].(map[string]any)
	return credits["trialBalance"]
}

func TestE2E_DeleteOwnAccountRemovesItAndTheEmailGetsNoSecondTrial(t *testing.T) {
	e := newAccountEnv(t)
	token := e.sign(nonAdminSub, accountPlainEmail)
	if got := trialBalance(t, e.base, token); got != float64(100) {
		t.Fatalf("first sign-up trial = %v, want 100", got)
	}
	userID := e.userID(t, nonAdminSub)

	code, body := doJSONBody(t, http.MethodDelete, e.base+"/api/me", token, map[string]string{"email": accountPlainEmail})
	if code != http.StatusOK || body["success"] != true {
		t.Fatalf("delete own account: %d %+v", code, body)
	}
	if got := e.clerk.recorded(); !slices.Contains(got, "DELETE /v1/users/"+nonAdminSub) {
		t.Fatalf("Clerk calls = %v, want the Clerk user deleted", got)
	}
	var users, ledger int64
	sqlitex.DB.Model(&sqlitex.User{}).Where("id = ?", userID).Count(&users)
	sqlitex.DB.Model(&sqlitex.CreditTransaction{}).Where("user_id = ?", userID).Count(&ledger)
	if users != 0 || ledger != 1 {
		t.Fatalf("after deletion: %d user row(s), %d ledger row(s); want 0 and the trial grant row kept", users, ledger)
	}

	// Signing in again gives a new Clerk id; the same email, written
	// differently, gets no trial.
	again := e.sign("user_plain_again", " Plain@Example.com")
	if got := trialBalance(t, e.base, again); got != float64(0) {
		t.Fatalf("re-registered trial = %v, want 0", got)
	}
}

func TestE2E_AdminDeleteWithResetTrialLetsTheEmailSignUpAsNew(t *testing.T) {
	e := newAccountEnv(t)
	adminToken := e.sign(adminSub, "admin@example.com")
	token := e.sign(nonAdminSub, accountPlainEmail)
	trialBalance(t, e.base, token)
	userID := e.userID(t, nonAdminSub)

	code, body := doJSON(t, http.MethodDelete, e.base+"/api/admin/users/"+userID+"?resetTrial=true", adminToken)
	if code != http.StatusOK {
		t.Fatalf("admin delete: %d %+v", code, body)
	}
	again := e.sign("user_plain_again", accountPlainEmail)
	if got := trialBalance(t, e.base, again); got != float64(100) {
		t.Fatalf("trial after a resetTrial deletion = %v, want 100", got)
	}
}

func TestE2E_DisabledAccountIsRejectedUntilEnabled(t *testing.T) {
	e := newAccountEnv(t)
	adminToken := e.sign(adminSub, "admin@example.com")
	token := e.sign(nonAdminSub, accountPlainEmail)
	if code, _ := doJSON(t, http.MethodGet, e.base+"/api/me", token); code != http.StatusOK {
		t.Fatalf("GET /api/me before: %d", code)
	}
	userID := e.userID(t, nonAdminSub)

	if code, body := doJSON(t, http.MethodPost, e.base+"/api/admin/users/"+userID+"/disable", adminToken); code != http.StatusOK {
		t.Fatalf("disable: %d %+v", code, body)
	}
	code, body := doJSON(t, http.MethodGet, e.base+"/api/me", token)
	if code != http.StatusForbidden || body["code"] != "account_disabled" || body["message"] != "This account has been disabled." {
		t.Fatalf("disabled user: %d %+v, want 403 account_disabled", code, body)
	}
	_, detail := doJSON(t, http.MethodGet, e.base+"/api/admin/users/"+userID, adminToken)
	if user, _ := detail["user"].(map[string]any); user["status"] != "disabled" {
		t.Fatalf("admin detail = %+v, want status disabled", detail["user"])
	}

	if code, body := doJSON(t, http.MethodPost, e.base+"/api/admin/users/"+userID+"/enable", adminToken); code != http.StatusOK {
		t.Fatalf("enable: %d %+v", code, body)
	}
	if code, body := doJSON(t, http.MethodGet, e.base+"/api/me", token); code != http.StatusOK {
		t.Fatalf("enabled user: %d %+v, want 200", code, body)
	}
	want := []string{"POST /v1/users/" + nonAdminSub + "/ban", "POST /v1/users/" + nonAdminSub + "/unban"}
	if got := e.clerk.recorded(); !slices.Equal(got, want) {
		t.Fatalf("Clerk calls = %v, want %v", got, want)
	}
}

// ADR-062 Decision 4: the admin's account actions sit behind RequireAdmin.
// A 403 also proves the route is registered: an unknown path is a 404.
func TestE2E_AdminAccountRoutesRequireAdmin(t *testing.T) {
	e := newAccountEnv(t)
	token := e.sign(nonAdminSub, accountPlainEmail)
	doJSON(t, http.MethodGet, e.base+"/api/me", token)
	userID := e.userID(t, nonAdminSub)

	for _, req := range []struct{ method, path string }{
		{http.MethodPost, "/api/admin/users/" + userID + "/disable"},
		{http.MethodPost, "/api/admin/users/" + userID + "/enable"},
		{http.MethodPost, "/api/admin/users/" + userID + "/revoke-sessions"},
		{http.MethodDelete, "/api/admin/users/" + userID},
	} {
		if code, _ := doJSON(t, req.method, e.base+req.path, token); code != http.StatusForbidden {
			t.Errorf("%s %s as non-admin: status %d, want 403", req.method, req.path, code)
		}
		if code, _ := doJSON(t, req.method, e.base+req.path, ""); code != http.StatusUnauthorized {
			t.Errorf("%s %s signed out: status %d, want 401", req.method, req.path, code)
		}
	}
	if got := e.clerk.recorded(); len(got) != 0 {
		t.Fatalf("Clerk calls = %v, want none", got)
	}
}
