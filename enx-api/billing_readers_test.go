//go:build integration

package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"enx-api/adminuser"
	"enx-api/clerktest"
	"enx-api/config"
	"enx-api/dictionary"
	"enx-api/metrics"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func TestBillingReaderCutoverUsesAcceptedSubscription(t *testing.T) {
	sqlitex.Init(filepath.Join(t.TempDir(), "readers.db"))
	if _, err := sqlitex.MigrateSubscriptionOwnership(sqlitex.DB); err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO users (id) VALUES (?)", "user_1").Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", "sub_conflict", "user_1", "active", "cus_1").Error; err != nil {
		t.Fatal(err)
	}
	reader := newBillingReaders(true).subscriptions
	active, err := reader.IsActiveSubscriber(context.Background(), "user_1")
	if err != nil || active {
		t.Fatalf("conflict grants subscription: active=%v err=%v", active, err)
	}
}

func TestBillingReaderLegacyUsesActiveSubscription(t *testing.T) {
	sqlitex.Init(filepath.Join(t.TempDir(), "legacy.db"))
	if err := sqlitex.DB.Exec("INSERT INTO subscriptions (user_id, stripe_customer_id, status, created_at, updated_at) VALUES (?, ?, ?, 1, 1)", "user_1", "cus_1", "active").Error; err != nil {
		t.Fatal(err)
	}
	active, err := newBillingReaders(false).subscriptions.IsActiveSubscriber(context.Background(), "user_1")
	if err != nil || !active {
		t.Fatalf("legacy subscription: active=%v err=%v", active, err)
	}
}

func TestEntitlementSourceUsesCutoverReader(t *testing.T) {
	sqlitex.Init(filepath.Join(t.TempDir(), "entitlement.db"))
	if _, err := sqlitex.MigrateSubscriptionOwnership(sqlitex.DB); err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO users (id) VALUES (?)", "user_1").Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", "sub_conflict", "user_1", "active", "cus_1").Error; err != nil {
		t.Fatal(err)
	}
	got, err := newBillingReaders(true).entitlements.Status(context.Background(), "user_1")
	if err != nil || got.Subscribed {
		t.Fatalf("conflict grants entitlement: %+v, %v", got, err)
	}
}

func TestQuotaResponseUsesCutoverSubscriptionReader(t *testing.T) {
	sqlitex.Init(filepath.Join(t.TempDir(), "quota.db"))
	if _, err := sqlitex.MigrateSubscriptionOwnership(sqlitex.DB); err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO users (id) VALUES (?)", "user_1").Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", "sub_conflict", "user_1", "active", "cus_1").Error; err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/", nil)
	dictionary.RespondQuotaExceededWithSubscriptions(c, "user_1", newBillingReaders(true).subscriptions)
	if !strings.Contains(w.Body.String(), "Upgrade") {
		t.Fatalf("conflict response: %s", w.Body.String())
	}
}

func TestAdminReaderCutoverShowsOneAccountForMultipleSubscriptions(t *testing.T) {
	sqlitex.Init(filepath.Join(t.TempDir(), "admin.db"))
	if _, err := sqlitex.MigrateSubscriptionOwnership(sqlitex.DB); err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO users (id, clerk_user_id) VALUES (?, ?)", "user_1", "clerk_1").Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"sub_a", "sub_b"} {
		if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", id, "user_1", "active", "cus_1").Error; err != nil {
			t.Fatal(err)
		}
	}
	rows, total, err := newBillingReaders(true).admin.ListAccounts(context.Background(), adminuser.ListQuery{Limit: 10})
	if err != nil || total != 1 || len(rows) != 1 {
		t.Fatalf("accounts %d total %d error %v", len(rows), total, err)
	}
}

type quotaEvents struct{}

func (quotaEvents) CountSince(context.Context, string, time.Time) (int64, error) { return 1, nil }
func (quotaEvents) Add(context.Context, dictionary.LookupEvent) error            { return nil }

func TestQuotaTierUsesSwitchSelectedReader(t *testing.T) {
	sqlitex.Init(filepath.Join(t.TempDir(), "tiers.db"))
	if _, err := sqlitex.MigrateSubscriptionOwnership(sqlitex.DB); err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO users (id) VALUES (?)", "user_1").Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", "sub_conflict", "user_1", "active", "cus_1").Error; err != nil {
		t.Fatal(err)
	}
	limits := config.StripeQuota{DictionaryLookupDailyFree: 1, DictionaryLookupDailySubscribed: 5}
	for _, tc := range []struct{ cutover, rejected bool }{{false, false}, {true, true}} {
		meter := dictionary.NewQuotaMeter(quotaEvents{}, newBillingReaders(tc.cutover).subscriptions, limits, time.Now)
		err := meter.Charge(context.Background(), "user_1")
		if errors.Is(err, dictionary.ErrQuotaExceeded) != tc.rejected {
			t.Fatalf("cutover %v: %v", tc.cutover, err)
		}
	}
}

func TestAdminReaderLegacyShowsSubscription(t *testing.T) {
	sqlitex.Init(filepath.Join(t.TempDir(), "legacy-admin.db"))
	if err := sqlitex.DB.Exec("INSERT INTO users (id, clerk_user_id) VALUES (?, ?)", "user_1", "clerk_1").Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("INSERT INTO subscriptions (user_id, stripe_customer_id, status, plan, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", "user_1", "cus_1", "active", "pro").Error; err != nil {
		t.Fatal(err)
	}
	rows, total, err := newBillingReaders(false).admin.ListAccounts(context.Background(), adminuser.ListQuery{Limit: 10})
	if err != nil || total != 1 || len(rows) != 1 || rows[0].SubscriptionStatus != "active" {
		t.Fatalf("accounts %+v total %d error %v", rows, total, err)
	}
}

func TestAdminRouteUsesCutoverReader(t *testing.T) {
	for _, cutover := range []bool{false, true} {
		t.Run(fmt.Sprint(cutover), func(t *testing.T) {
			jwks := clerktest.NewEnv(t)
			cfg := config.Default()
			cfg.Clerk = jwks.Config()
			cfg.Admin.ClerkUserIDs = []string{adminSub}
			cfg.Billing.Cutover = cutover
			sqlitex.Init(filepath.Join(t.TempDir(), "route.db"))
			if cutover {
				if _, err := sqlitex.MigrateSubscriptionOwnership(sqlitex.DB); err != nil {
					t.Fatal(err)
				}
			}
			if err := sqlitex.DB.Exec("INSERT INTO users (id, clerk_user_id, email) VALUES (?, ?, ?)", "target", "clerk_target", "target@example.com").Error; err != nil {
				t.Fatal(err)
			}
			if cutover {
				for _, id := range []string{"sub_a", "sub_b"} {
					if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", id, "target", "active", "cus_1").Error; err != nil {
						t.Fatal(err)
					}
				}
			} else if err := sqlitex.DB.Exec("INSERT INTO subscriptions (user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, 1, 1)", "target", "active", "cus_1").Error; err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), nil, nil))
			defer server.Close()
			token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": adminSub, "email": "admin@example.com"})
			code, body := doJSON(t, http.MethodGet, server.URL+"/api/admin/users?q=target@example.com", token)
			if code != http.StatusOK || body["total"] != float64(1) {
				t.Fatalf("cutover %v: %d %v", cutover, code, body)
			}
			rows, ok := body["users"].([]any)
			if !ok || len(rows) != 1 {
				t.Fatalf("cutover %v: %v", cutover, body)
			}
		})
	}
}

func TestQuotaRoutesUseCutoverReader(t *testing.T) {
	for _, cutover := range []bool{false, true} {
		t.Run(fmt.Sprint(cutover), func(t *testing.T) {
			jwks := clerktest.NewEnv(t)
			cfg := config.Default()
			cfg.Clerk = jwks.Config()
			cfg.Billing.Cutover = cutover
			cfg.Stripe.Quota.DictionaryLookupDailyFree = 1
			cfg.Stripe.Quota.DictionaryLookupDailySubscribed = 1
			sqlitex.Init(filepath.Join(t.TempDir(), "quota-route.db"))
			if cutover {
				if _, err := sqlitex.MigrateSubscriptionOwnership(sqlitex.DB); err != nil {
					t.Fatal(err)
				}
			}
			if err := sqlitex.DB.Exec("INSERT INTO users (id, clerk_user_id, email) VALUES (?, ?, ?)", "target", "clerk_target", "target@example.com").Error; err != nil {
				t.Fatal(err)
			}
			if cutover {
				if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", "conflict", "target", "active", "cus_1").Error; err != nil {
					t.Fatal(err)
				}
			} else if err := sqlitex.DB.Exec("INSERT INTO subscriptions (user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, 1, 1)", "target", "active", "cus_1").Error; err != nil {
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
			if status != http.StatusOK || !ok || fallback["effective"] != !cutover {
				t.Fatalf("entitlement cutover %v: %d %v", cutover, status, prefs)
			}
			cfg.Stripe.Quota.DictionaryLookupDailySubscribed = 5
			tierServer := httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), nil, nil))
			tierCode, tierBody := doJSON(t, http.MethodGet, tierServer.URL+"/api/translate?word=example", token)
			tierServer.Close()
			if (tierCode == http.StatusTooManyRequests) != cutover {
				t.Fatalf("quota tier cutover %v: %d %v", cutover, tierCode, tierBody)
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
				want := "contact support"
				if cutover {
					want = "Upgrade"
				}
				if code != http.StatusTooManyRequests || !strings.Contains(message, want) {
					t.Fatalf("%s cutover %v: %d %v", route, cutover, code, body)
				}
			}
		})
	}
}
