//go:build integration

package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"enx-api/account"
	"enx-api/clerktest"
	"enx-api/config"
	"enx-api/metrics"
	"enx-api/utils/sqlitex"

	"github.com/golang-jwt/jwt/v5"
	stripeSDK "github.com/stripe/stripe-go/v86"
)

func TestDeletionRoutesSelectCutoverChecker(t *testing.T) {
	for _, tc := range []struct {
		name           string
		cutover        bool
		stored         string
		classification string
		response       string
		status         int
		code           string
		extra          string
	}{
		{"legacy missing", false, "active", "", "", 200, "", ""},
		{"missing", true, "active", "", "", 500, "failed", ""},
		{"unknown live state", true, "active", "", "error", 500, "failed", ""},
		{"store failure", true, "active", "", "", 500, "failed", "store"},
		{"renewing unpaid", true, "unpaid", "", `{"id":"sub_missing","status":"active"}`, 409, "subscription_active", ""},
		{"scheduled unpaid", true, "unpaid", "", `{"id":"sub_missing","status":"unpaid","cancel_at_period_end":true}`, 200, "", ""},
		{"unpaid ended", true, "unpaid", "", `{"id":"sub_missing","status":"canceled"}`, 200, "", ""},
		{"renewing beats unknown", true, "unpaid", "", `{"id":"sub_missing","status":"active"}`, 409, "subscription_active", "unknown"},
		{"conflict beats renewing and unknown", true, "unpaid", "", `{"id":"sub_missing","status":"active"}`, 409, "subscription_conflict", "conflict"},
		{"open conflict", true, "canceled", "conflict", "", 409, "subscription_conflict", ""},
	} {
		cutover := tc.cutover
		for _, admin := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/admin=%v", tc.name, admin), func(t *testing.T) {
				jwks := clerktest.NewEnv(t)
				cfg := config.Default()
				cfg.Clerk = jwks.Config()
				cfg.Admin.ClerkUserIDs = []string{adminSub}
				cfg.Account.EmailHMACKey = "test-key"
				cfg.Billing.Cutover = cutover
				sqlitex.Init(filepath.Join(t.TempDir(), "account.db"))
				if cutover {
					if err := sqlitex.MigrateBillingCutover(sqlitex.DB); err != nil {
						t.Fatal(err)
					}
				}
				if err := sqlitex.DB.Exec("INSERT INTO users (id, clerk_user_id, email) VALUES (?, ?, ?)", "target", nonAdminSub, accountPlainEmail).Error; err != nil {
					t.Fatal(err)
				}
				if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", "sub_missing", "target", tc.stored, "cus_1").Error; err != nil {
					t.Fatal(err)
				}
				grant := sqlitex.TrialGrant{EmailHmac: account.NewEmailHMAC("test-key").Of(accountPlainEmail), UserId: "target", GrantedAt: 123}
				if err := sqlitex.DB.Create(&grant).Error; err != nil {
					t.Fatal(err)
				}
				if tc.classification != "" {
					if err := sqlitex.DB.Exec("UPDATE subscriptions SET classification = ? WHERE stripe_subscription_id = ?", tc.classification, "sub_missing").Error; err != nil {
						t.Fatal(err)
					}
				}
				if tc.extra != "" && tc.extra != "store" {
					if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)", "sub_unknown", "target", "active", "cus_1").Error; err != nil {
						t.Fatal(err)
					}
					if tc.extra == "conflict" {
						if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, user_id, status, classification, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)", "sub_conflict", "target", "canceled", "conflict", "cus_1").Error; err != nil {
							t.Fatal(err)
						}
					}
				}
				stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					if tc.response == "error" {
						w.WriteHeader(http.StatusBadRequest)
						_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"unavailable"}}`))
					} else if tc.response == "" || r.URL.Path == "/v1/subscriptions/sub_unknown" {
						w.WriteHeader(http.StatusNotFound)
						_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"missing"}}`))
					} else {
						_, _ = w.Write([]byte(tc.response))
					}
				}))
				defer stripeServer.Close()
				backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{URL: stripeSDK.String(stripeServer.URL), HTTPClient: stripeServer.Client()})
				sc := stripeSDK.NewClient("sk_test", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
				clerk := &fakeClerkBackend{}
				server := httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), sc, clerk.client(t)))
				defer server.Close()
				if tc.extra == "store" {
					if err := sqlitex.DB.Exec("DROP TABLE subscriptions").Error; err != nil {
						t.Fatal(err)
					}
				}
				token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": nonAdminSub, "email": accountPlainEmail})
				var status int
				var body map[string]any
				if admin {
					token = jwks.SignSessionToken(t, jwt.MapClaims{"sub": adminSub, "email": "admin@example.com"})
					status, body = doJSON(t, http.MethodDelete, server.URL+"/api/admin/users/target?resetTrial=true", token)
				} else {
					status, body = doJSONBody(t, http.MethodDelete, server.URL+"/api/me", token, map[string]string{"email": accountPlainEmail})
				}
				if status != tc.status || (tc.code != "" && body["code"] != tc.code) {
					t.Fatalf("status %d body %v, want %d %s", status, body, tc.status, tc.code)
				}
				blocked := tc.status != http.StatusOK
				wantMessage := map[string]string{
					"failed":                "The account action failed. Try again.",
					"subscription_conflict": "Contact an administrator to resolve your subscription issue before deleting your account.",
					"subscription_active":   "Cancel your subscription on the Billing page before deleting your account.",
				}
				if body["success"] != !blocked {
					t.Fatalf("success: %v", body)
				}
				if blocked && body["message"] != wantMessage[tc.code] {
					t.Fatalf("message: %v", body)
				}
				if !blocked {
					if _, ok := body["code"]; ok {
						t.Fatalf("unexpected code: %v", body)
					}
					if _, ok := body["message"]; ok {
						t.Fatalf("unexpected message: %v", body)
					}
				}
				if blocked {
					var after sqlitex.TrialGrant
					if err := sqlitex.DB.First(&after, "email_hmac = ?", grant.EmailHmac).Error; err != nil || after != grant {
						t.Fatalf("trial grant changed: %+v, %v", after, err)
					}
				}

				var count int64
				if err := sqlitex.DB.Model(&sqlitex.User{}).Where("id = ?", "target").Count(&count).Error; err != nil {
					t.Fatal(err)
				}
				if (count == 1) != blocked {
					t.Fatalf("remaining users %d", count)
				}
				if (len(clerk.recorded()) == 0) != blocked {
					t.Fatalf("Clerk calls %v", clerk.recorded())
				}
			})
		}
	}
}
