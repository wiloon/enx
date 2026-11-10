//go:build integration

package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"enx-api/account"
	accountadapters "enx-api/account/adapters"
	"enx-api/clerktest"
	"enx-api/config"
	"enx-api/metrics"
	"enx-api/utils/sqlitex"

	"github.com/golang-jwt/jwt/v5"
)

type deletionClerk struct {
	account.Clerk
	remove func() error
}

func (c deletionClerk) DeleteUser(context.Context, string) error { return c.remove() }

// The gate is established by a production deletion route. Expiring a
// persisted lease models elapsed time without minute-long sleeps.
func deletionRecoveryEnv(t *testing.T) (func(account.Clerk) *httptest.Server, func(bool, string) (int, map[string]any)) {
	t.Helper()
	jwks := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = jwks.Config()
	cfg.Admin.ClerkUserIDs = []string{adminSub}
	cfg.Account.EmailHMACKey = "test-key"

	sqlitex.Init(filepath.Join(t.TempDir(), "recovery.db"))
	if err := sqlitex.InitializeBillingSchema(sqlitex.DB); err != nil {
		t.Fatal(err)
	}
	deletionSQL(t, "INSERT INTO users (id, clerk_user_id, email) VALUES ('target', ?, ?)", nonAdminSub, accountPlainEmail)
	var server *httptest.Server
	start := func(clerk account.Clerk) *httptest.Server {
		server = httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), nil, clerk))
		t.Cleanup(server.Close)
		return server
	}
	request := func(admin bool, query string) (int, map[string]any) {
		if admin {
			token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": adminSub, "email": "admin@example.com"})
			return doJSON(t, http.MethodDelete, server.URL+"/api/admin/users/target"+query, token)
		}
		token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": nonAdminSub, "email": accountPlainEmail})
		return doJSONBody(t, http.MethodDelete, server.URL+"/api/me", token, map[string]string{"email": accountPlainEmail})
	}
	return start, request
}

func deletionSQL(t *testing.T, query string, args ...any) {
	t.Helper()
	if err := sqlitex.DB.Exec(query, args...).Error; err != nil {
		t.Fatal(err)
	}
}

func deletionCount(t *testing.T, query string, want int) {
	t.Helper()
	var got int
	if err := sqlitex.DB.Raw(query).Scan(&got).Error; err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("%s = %d, want %d", query, got, want)
	}
}

// The lease, takeover and fencing rules are pinned in repo, account and
// handlers; this walks one deletion across a restart end to end.
func TestDeletionRecoversAnUncertainClerkCallAfterRestartWithTheOriginalIntent(t *testing.T) {
	start, request := deletionRecoveryEnv(t)
	hash := account.NewEmailHMAC("test-key").Of(accountPlainEmail)
	deletionSQL(t, "INSERT INTO trial_grants (email_hmac, user_id, granted_at) VALUES (?, 'target', 123)", hash)
	calls := 0
	original := start(deletionClerk{remove: func() error {
		calls++
		deletionCount(t, "SELECT count(*) FROM account_deletion_gates WHERE user_id = 'target' AND state = 'in_progress'", 1)
		deletionCount(t, "SELECT count(*) FROM account_deletion_attempts WHERE user_id = 'target' AND phase = 'irreversible'", 1)
		return errors.New("response lost after remote deletion")
	}})
	if code, body := request(true, "?resetTrial=true"); code != 500 {
		t.Fatalf("first attempt %d %v", code, body)
	}
	deletionCount(t, "SELECT count(*) FROM users WHERE id = 'target'", 1)
	// The other route can neither release the attempt nor call Clerk itself.
	if code, body := request(false, ""); code != 503 || body["code"] != "deletion_in_progress" {
		t.Fatalf("overlap %d %v", code, body)
	}
	if calls != 1 {
		t.Fatalf("overlap invoked Clerk: %d", calls)
	}
	deletionSQL(t, "UPDATE account_deletion_attempts SET lease_until = 0")

	// Recreate the router and services on the persisted database. Admin
	// recovery needs no session for the target, whose Clerk identity is gone.
	original.Close()
	absentCalls := 0
	absent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		absentCalls++
		if r.Method != http.MethodDelete || r.URL.Path != "/users/"+nonAdminSub {
			t.Errorf("unexpected Clerk request: %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer absent.Close()
	recoveredClerk := accountadapters.NewClerk("test")
	recoveredClerk.BaseURL = absent.URL
	recoveredClerk.HTTP = absent.Client()
	start(recoveredClerk)
	// Recovery asks to keep the trial; the original reset still wins.
	if code, body := request(true, ""); code != 200 {
		t.Fatalf("recovery %d %v", code, body)
	}
	if absentCalls != 1 {
		t.Fatalf("recovery did not repeat the Clerk deletion: %d", absentCalls)
	}
	deletionCount(t, "SELECT count(*) FROM users WHERE id = 'target'", 0)
	deletionCount(t, "SELECT count(*) FROM account_deletion_gates WHERE user_id = 'target' AND state = 'deleted'", 1)
	deletionCount(t, "SELECT count(*) FROM account_deletion_attempts", 0)
	deletionCount(t, "SELECT count(*) FROM trial_grants WHERE user_id = 'target'", 0)
}
