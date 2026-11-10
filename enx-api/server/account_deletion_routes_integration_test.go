//go:build integration

package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"enx-api/clerktest"
	"enx-api/config"
	"enx-api/metrics"
	"enx-api/utils/sqlitex"

	"github.com/golang-jwt/jwt/v5"
	stripeSDK "github.com/stripe/stripe-go/v86"
)

// Both deletion routes are wired to the billing deletion check and the
// deletion gate. The verdict rules live in billing/eligibility and
// billing/deletion, the gate in account and repo; this only proves the wiring.
func TestDeletionRoutesCheckBillingAndHoldTheDeletionGate(t *testing.T) {
	for _, tc := range []struct {
		name   string
		live   string
		status int
		code   string
	}{
		{"renewing subscription blocks", `{"id":"sub_1","status":"active"}`, http.StatusConflict, "subscription_active"},
		{"canceled subscription deletes", `{"id":"sub_1","status":"canceled"}`, http.StatusOK, ""},
	} {
		for _, admin := range []bool{false, true} {
			t.Run(tc.name+map[bool]string{false: "/own", true: "/admin"}[admin], func(t *testing.T) {
				jwks := clerktest.NewEnv(t)
				cfg := config.Default()
				cfg.Clerk = jwks.Config()
				cfg.Admin.ClerkUserIDs = []string{adminSub}
				cfg.Account.EmailHMACKey = "test-key"

				sqlitex.Init(filepath.Join(t.TempDir(), "account.db"))
				if err := sqlitex.InitializeBillingSchema(sqlitex.DB); err != nil {
					t.Fatal(err)
				}
				if err := sqlitex.DB.Exec("INSERT INTO users (id, clerk_user_id, email) VALUES (?, ?, ?)", "target", nonAdminSub, accountPlainEmail).Error; err != nil {
					t.Fatal(err)
				}
				if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES ('sub_1', 'target', 'active', 'cus_1', 1, 1)").Error; err != nil {
					t.Fatal(err)
				}
				stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(tc.live))
				}))
				defer stripeServer.Close()
				backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{URL: stripeSDK.String(stripeServer.URL), HTTPClient: stripeServer.Client()})
				sc := stripeSDK.NewClient("sk_test", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
				clerk := &fakeClerkBackend{}
				server := httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), sc, clerk.client(t)))
				defer server.Close()

				var status int
				var body map[string]any
				if admin {
					token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": adminSub, "email": "admin@example.com"})
					status, body = doJSON(t, http.MethodDelete, server.URL+"/api/admin/users/target", token)
				} else {
					token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": nonAdminSub, "email": accountPlainEmail})
					status, body = doJSONBody(t, http.MethodDelete, server.URL+"/api/me", token, map[string]string{"email": accountPlainEmail})
				}
				if status != tc.status || (tc.code != "" && body["code"] != tc.code) {
					t.Fatalf("status %d body %v, want %d %s", status, body, tc.status, tc.code)
				}

				blocked := tc.status != http.StatusOK
				var states []string
				if err := sqlitex.DB.Raw("SELECT state FROM account_deletion_gates WHERE user_id = ?", "target").Scan(&states).Error; err != nil {
					t.Fatal(err)
				}
				if blocked && len(states) != 0 {
					t.Fatalf("a blocked deletion must lift the gate: %v", states)
				}
				if !blocked && (len(states) != 1 || states[0] != "deleted") {
					t.Fatalf("a deletion must keep a deleted gate: %v", states)
				}
				var users int64
				if err := sqlitex.DB.Model(&sqlitex.User{}).Where("id = ?", "target").Count(&users).Error; err != nil {
					t.Fatal(err)
				}
				if (users == 1) != blocked {
					t.Fatalf("remaining users %d", users)
				}
				if (len(clerk.recorded()) == 0) != blocked {
					t.Fatalf("Clerk calls %v", clerk.recorded())
				}
			})
		}
	}
}
