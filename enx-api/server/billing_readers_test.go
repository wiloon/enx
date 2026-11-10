//go:build integration

package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"enx-api/clerktest"
	"enx-api/config"
	"enx-api/metrics"
	"enx-api/utils/sqlitex"

	"github.com/golang-jwt/jwt/v5"
)

func TestAdminRouteUsesCutoverReader(t *testing.T) {
	jwks := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = jwks.Config()
	cfg.Admin.ClerkUserIDs = []string{adminSub}

	sqlitex.Init(filepath.Join(t.TempDir(), "route.db"))
	if _, err := sqlitex.MigrateSubscriptionOwnership(sqlitex.DB); err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO users (id, clerk_user_id, email) VALUES (?, ?, ?)", "target", "clerk_target", "target@example.com").Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"sub_a", "sub_b"} {
		if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", id, "target", "active", "cus_1").Error; err != nil {
			t.Fatal(err)
		}
	}
	server := httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), nil, nil))
	defer server.Close()
	token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": adminSub, "email": "admin@example.com"})
	code, body := doJSON(t, http.MethodGet, server.URL+"/api/admin/users?q=target@example.com", token)
	if code != http.StatusOK || body["total"] != float64(1) {
		t.Fatalf("admin users = %d %v", code, body)
	}
	rows, ok := body["users"].([]any)
	if !ok || len(rows) != 1 {
		t.Fatalf("admin users = %v", body)
	}
}

func TestQuotaRoutesUseCutoverReader(t *testing.T) {
	jwks := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = jwks.Config()

	cfg.Stripe.Quota.DictionaryLookupDailyFree = 1
	cfg.Stripe.Quota.DictionaryLookupDailySubscribed = 1
	sqlitex.Init(filepath.Join(t.TempDir(), "quota-route.db"))
	if _, err := sqlitex.MigrateSubscriptionOwnership(sqlitex.DB); err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO users (id, clerk_user_id, email) VALUES (?, ?, ?)", "target", "clerk_target", "target@example.com").Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", "conflict", "target", "active", "cus_1").Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Create(&sqlitex.Word{Id: "w1", English: "example"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Create(&sqlitex.LookupEvent{UserID: "target", At: time.Now().UnixMilli(), Outcome: "allowed"}).Error; err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), nil, nil))
	defer server.Close()
	token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": "clerk_target", "email": "target@example.com"})
	status, prefs := doJSON(t, http.MethodGet, server.URL+"/api/me/preferences", token)
	fallback, ok := prefs["aiWordFallback"].(map[string]any)
	if status != http.StatusOK || !ok || fallback["effective"] != false {
		t.Fatalf("a conflict made AI fallback effective: %d %v", status, prefs)
	}
	cfg.Stripe.Quota.DictionaryLookupDailySubscribed = 5
	tierServer := httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), nil, nil))
	tierCode, tierBody := doJSON(t, http.MethodGet, tierServer.URL+"/api/translate?word=example", token)
	tierServer.Close()
	if tierCode != http.StatusTooManyRequests {
		t.Fatalf("a conflict got the subscribed quota: %d %v", tierCode, tierBody)
	}
	if err := sqlitex.DB.Exec("DELETE FROM lookup_events WHERE user_id = ?", "target").Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Create(&sqlitex.LookupEvent{UserID: "target", At: time.Now().UnixMilli(), Outcome: "allowed"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, route := range []string{"get", "cached"} {
		var code int
		var body map[string]any
		if route == "get" {
			code, body = doJSON(t, http.MethodGet, server.URL+"/api/translate?word=example", token)
		} else {
			code, body = doJSONBody(t, http.MethodPost, server.URL+"/api/me/word-lookups", token, map[string]any{"wordId": "w1", "fromCache": true})
		}
		message, _ := body["message"].(string)
		if code != http.StatusTooManyRequests || !strings.Contains(message, "Upgrade") {
			t.Fatalf("%s: %d %v", route, code, body)
		}
	}
}
