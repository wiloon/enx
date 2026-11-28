//go:build integration

package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"enx-api/config"
	"enx-api/metrics"
	"enx-api/platform/clerktest"
	"enx-api/utils/sqlitex"
	"enx-api/utils/sqlitex/sqlitextest"

	"github.com/golang-jwt/jwt/v5"
)

func TestAdminRouteUsesCutoverReader(t *testing.T) {
	jwks := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = jwks.Config()
	cfg.Admin.AuthSubjects = []string{adminSub}

	db := sqlitextest.Open(t)
	if _, err := sqlitex.MigrateSubscriptionOwnership(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO users (id, auth_subject, email) VALUES (?, ?, ?)", "target", "clerk_target", "target@example.com").Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"sub_a", "sub_b"} {
		if err := db.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", id, "target", "active", "cus_1").Error; err != nil {
			t.Fatal(err)
		}
	}
	server := httptest.NewServer(setupRouterWithClients(db, cfg, metrics.New(), nil, nil))
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
	cfg.Stripe.Quota.DictionaryLookupDailyPaid = 1
	db := sqlitextest.Open(t)
	if _, err := sqlitex.MigrateSubscriptionOwnership(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO users (id, auth_subject, email) VALUES (?, ?, ?)", "target", "clerk_target", "target@example.com").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", "conflict", "target", "active", "cus_1").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&sqlitex.Word{Id: "w1", English: "example"}).Error; err != nil {
		t.Fatal(err)
	}
	setUsed := func(userID string, n int64) {
		t.Helper()
		if err := db.Exec("DELETE FROM dictionary_quota_usage WHERE user_id = ?", userID).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&sqlitex.DictionaryQuotaUsage{UserID: userID, UTCDay: time.Now().UTC().Format("2006-01-02"), Used: n}).Error; err != nil {
			t.Fatal(err)
		}
	}
	useQuota := func() { setUsed("target", 1) }
	useQuota()
	server := httptest.NewServer(setupRouterWithClients(db, cfg, metrics.New(), nil, nil))
	defer server.Close()
	token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": "clerk_target", "email": "target@example.com"})
	status, prefs := doJSON(t, http.MethodGet, server.URL+"/api/me/preferences", token)
	fallback, ok := prefs["aiWordFallback"].(map[string]any)
	if status != http.StatusOK || !ok || fallback["effective"] != false {
		t.Fatalf("a conflict made AI fallback effective: %d %v", status, prefs)
	}
	cfg.Stripe.Quota.DictionaryLookupDailyPaid = 5
	tierServer := httptest.NewServer(setupRouterWithClients(db, cfg, metrics.New(), nil, nil))
	defer tierServer.Close()
	tierCode, tierBody := doJSON(t, http.MethodGet, tierServer.URL+"/api/translate?word=example", token)
	if tierCode != http.StatusTooManyRequests {
		t.Fatalf("a conflict got the subscribed quota: %d %v", tierCode, tierBody)
	}
	for _, route := range []string{"get", "post", "query"} {
		useQuota()
		var code int
		var body map[string]any
		switch route {
		case "get":
			code, body = doJSON(t, http.MethodGet, server.URL+"/api/translate?word=example", token)
		case "post":
			code, body = doJSONBody(t, http.MethodPost, server.URL+"/api/me/word-lookups", token, map[string]any{"wordId": "w1"})
		default:
			code, body = doJSONBody(t, http.MethodPost, server.URL+"/api/dictionary/entries/query", token, map[string]any{"words": []string{"example"}})
		}
		message, _ := body["message"].(string)
		if code != http.StatusTooManyRequests || !strings.Contains(message, "Upgrade") {
			t.Fatalf("%s: %d %v", route, code, body)
		}
	}

	// ADR-093: no accepted subscription and a top-up balance is the paid tier
	// (free=1, paid=5 on tierServer).
	if err := db.Exec("INSERT INTO users (id, auth_subject, email) VALUES (?, ?, ?)", "topup", "clerk_topup", "topup@example.com").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&sqlitex.CreditAccount{UserId: "topup", TopupBalance: 1, UpdatedAt: 1}).Error; err != nil {
		t.Fatal(err)
	}
	topupToken := jwks.SignSessionToken(t, jwt.MapClaims{"sub": "clerk_topup", "email": "topup@example.com"})
	const paidMessage = "Daily dictionary lookup limit reached. That is unusually high for a paid account -- please contact support."
	for _, route := range []string{"get", "post", "query"} {
		setUsed("topup", 5)
		var code int
		var body map[string]any
		switch route {
		case "get":
			code, body = doJSON(t, http.MethodGet, tierServer.URL+"/api/translate?word=example", topupToken)
		case "post":
			code, body = doJSONBody(t, http.MethodPost, tierServer.URL+"/api/me/word-lookups", topupToken, map[string]any{"wordId": "w1"})
		default:
			code, body = doJSONBody(t, http.MethodPost, tierServer.URL+"/api/dictionary/entries/query", topupToken, map[string]any{"words": []string{"example"}})
		}
		if _, upgrade := body["upgrade"]; code != http.StatusTooManyRequests || body["message"] != paidMessage || upgrade {
			t.Errorf("top-up user, %s: %d %v, want 429 with the paid-tier message and no upgrade", route, code, body)
		}
	}
	// The free ceiling does not hold them. Last: an allowed translate may
	// record the word as looked up, which makes the entries query free.
	setUsed("topup", 1)
	if code, body := doJSON(t, http.MethodGet, tierServer.URL+"/api/translate?word=example", topupToken); code == http.StatusTooManyRequests {
		t.Errorf("a top-up user was held to the free ceiling: %d %v", code, body)
	}
}
