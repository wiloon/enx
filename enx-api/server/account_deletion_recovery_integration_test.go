//go:build integration

package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/account"
	accountadapters "enx-api/account/adapters"
	"enx-api/config"
	"enx-api/metrics"
	"enx-api/platform/clerktest"
	"enx-api/utils/sqlitex"
	"enx-api/utils/sqlitex/sqlitextest"

	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
)

type deletionClerk struct {
	account.ExternalIdentity
	remove func() error
}

func (c deletionClerk) DeleteUser(context.Context, string) error { return c.remove() }

// The gate is established by a production deletion route. Expiring a
// persisted lease models elapsed time without minute-long sleeps.
func deletionRecoveryEnv(t *testing.T) (*gorm.DB, func(account.ExternalIdentity) *httptest.Server, func(bool, string) (int, map[string]any)) {
	t.Helper()
	jwks := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = jwks.Config()
	cfg.Admin.AuthSubjects = []string{adminSub}
	cfg.Account.EmailHMACKey = "test-key"

	db := sqlitextest.Open(t)
	if err := sqlitex.InitializeBillingSchema(db); err != nil {
		t.Fatal(err)
	}
	deletionSQL(t, db, "INSERT INTO users (id, auth_subject, email) VALUES ('target', ?, ?)", nonAdminSub, accountPlainEmail)
	var server *httptest.Server
	start := func(clerk account.ExternalIdentity) *httptest.Server {
		server = httptest.NewServer(setupRouterWithClients(db, cfg, metrics.New(), nil, clerk))
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
	return db, start, request
}

func deletionSQL(t *testing.T, db *gorm.DB, query string, args ...any) {
	t.Helper()
	if err := db.Exec(query, args...).Error; err != nil {
		t.Fatal(err)
	}
}

func deletionCount(t *testing.T, db *gorm.DB, query string, want int) {
	t.Helper()
	var got int
	if err := db.Raw(query).Scan(&got).Error; err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("%s = %d, want %d", query, got, want)
	}
}

// The lease, takeover and fencing rules are pinned in repo, account and
// handlers; this walks one deletion across a restart end to end.
func TestDeletionRecoversAnUncertainClerkCallAfterRestartWithTheOriginalIntent(t *testing.T) {
	db, start, request := deletionRecoveryEnv(t)
	hash := account.NewEmailHMAC("test-key").Of(accountPlainEmail)
	deletionSQL(t, db, "INSERT INTO trial_grants (email_hmac, user_id, granted_at) VALUES (?, 'target', 123)", hash)
	calls := 0
	original := start(deletionClerk{remove: func() error {
		calls++
		deletionCount(t, db, "SELECT count(*) FROM account_deletion_gates WHERE user_id = 'target' AND state = 'in_progress'", 1)
		deletionCount(t, db, "SELECT count(*) FROM account_deletion_attempts WHERE user_id = 'target' AND phase = 'irreversible'", 1)
		return errors.New("response lost after remote deletion")
	}})
	if code, body := request(true, "?resetTrial=true"); code != 500 {
		t.Fatalf("first attempt %d %v", code, body)
	}
	deletionCount(t, db, "SELECT count(*) FROM users WHERE id = 'target'", 1)
	// The other route can neither release the attempt nor call Clerk itself.
	if code, body := request(false, ""); code != 503 || body["code"] != "deletion_in_progress" {
		t.Fatalf("overlap %d %v", code, body)
	}
	if calls != 1 {
		t.Fatalf("overlap invoked Clerk: %d", calls)
	}
	deletionSQL(t, db, "UPDATE account_deletion_attempts SET lease_until = 0")

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
	deletionCount(t, db, "SELECT count(*) FROM users WHERE id = 'target'", 0)
	deletionCount(t, db, "SELECT count(*) FROM account_deletion_gates WHERE user_id = 'target' AND state = 'deleted'", 1)
	deletionCount(t, db, "SELECT count(*) FROM account_deletion_attempts", 0)
	deletionCount(t, db, "SELECT count(*) FROM trial_grants WHERE user_id = 'target'", 0)
}
