//go:build integration

package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"testing"

	"enx-api/clerktest"
	"enx-api/config"
	"enx-api/metrics"
	"enx-api/utils/sqlitex"

	"github.com/golang-jwt/jwt/v5"
)

func billingMeRoute(t *testing.T, cutover bool) (*httptest.Server, string) {
	t.Helper()
	restoreBillingDatabase(t)
	jwks := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = jwks.Config()

	if err := openBillingDatabase(t, func() error {
		return initializeBillingDatabase(filepath.Join(t.TempDir(), "billing-me.db"), "error")
	}); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		"INSERT INTO users (id, clerk_user_id, email) VALUES ('billing_me', 'clerk_billing_me', 'billing@example.com')",
		"INSERT INTO credit_accounts (user_id, subscription_balance, topup_balance, trial_balance, trial_expires_at, updated_at) VALUES ('billing_me', 120, 340, 56, 4102444800, 1)",
	} {
		if err := sqlitex.DB.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	server := httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), nil, nil))
	t.Cleanup(server.Close)
	token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": "clerk_billing_me", "email": "billing@example.com"})
	return server, token
}

func assertBillingMe(t *testing.T, server *httptest.Server, token, status, plan string, periodEnd float64) {
	t.Helper()
	code, body := doJSON(t, http.MethodGet, server.URL+"/api/billing/me", token)
	if code != http.StatusOK || body["success"] != true {
		t.Fatalf("billing/me = %d %v", code, body)
	}
	wantSubscription := map[string]any{"status": status, "plan": plan, "currentPeriodEnd": periodEnd}
	if !reflect.DeepEqual(body["subscription"], wantSubscription) {
		t.Errorf("subscription = %v, want %v", body["subscription"], wantSubscription)
	}
	wantCredits := map[string]any{
		"subscriptionBalance": float64(120), "topupBalance": float64(340),
		"trialBalance": float64(56), "trialExpiresAt": float64(4102444800),
	}
	if !reflect.DeepEqual(body["credits"], wantCredits) {
		t.Errorf("credits = %v, want %v", body["credits"], wantCredits)
	}
}

func TestBillingMeCutoverDisplaysAcceptedSnapshotDespiteConflict(t *testing.T) {
	server, token := billingMeRoute(t, true)
	for _, statement := range []string{
		"INSERT INTO subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, plan, current_period_end, classification, conflict_status, created_at, updated_at) VALUES ('sub_a_conflict', 'billing_me', 'cus_conflict', 'active', 'pro', 123, 'conflict', 'open', 1, 1)",
		"INSERT INTO subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, plan, current_period_end, classification, created_at, updated_at) VALUES ('sub_z_accepted', 'billing_me', 'cus_accepted', 'past_due', 'max', 1795507901, 'accepted', 1, 1)",
		"UPDATE users SET accepted_subscription_id = 'sub_z_accepted' WHERE id = 'billing_me'",
	} {
		if err := sqlitex.DB.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	assertBillingMe(t, server, token, "past_due", "max", 1795507901)
}

func TestBillingMeCutoverReaderFailureIsNotAbsence(t *testing.T) {
	server, token := billingMeRoute(t, true)
	if err := sqlitex.DB.Exec("DROP TABLE subscriptions").Error; err != nil {
		t.Fatal(err)
	}
	code, body := doJSON(t, http.MethodGet, server.URL+"/api/billing/me", token)
	if code < 500 || body["success"] != false {
		t.Fatalf("reader failure = %d %v, want server error and success false", code, body)
	}
}

func TestBillingMeCutoverWithoutAcceptedSubscriptionReturnsDefaults(t *testing.T) {
	for _, scenario := range []string{"never subscribed", "conflict only"} {
		t.Run(scenario, func(t *testing.T) {
			server, token := billingMeRoute(t, true)
			if scenario == "conflict only" {
				if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, plan, current_period_end, classification, conflict_status, created_at, updated_at) VALUES ('sub_conflict', 'billing_me', 'cus_conflict', 'active', 'pro', 123, 'conflict', 'open', 1, 1)").Error; err != nil {
					t.Fatal(err)
				}
			}
			assertBillingMe(t, server, token, "none", "", 0)
		})
	}
}
