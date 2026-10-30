//go:build integration

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"enx-api/clerktest"
	"enx-api/config"
	"enx-api/metrics"
	"enx-api/utils/sqlitex"

	"github.com/golang-jwt/jwt/v5"
	stripeSDK "github.com/stripe/stripe-go/v86"
)

type checkoutFixture struct {
	server *httptest.Server
	token  string
	forms  []url.Values
	live   map[string]string
	cancel bool
}

func checkoutRoute(t *testing.T, cutover bool) *checkoutFixture {
	t.Helper()
	restoreBillingDatabase(t)
	jwks := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = jwks.Config()

	if err := openBillingDatabase(t, func() error {
		return initializeBillingDatabase(filepath.Join(t.TempDir(), "checkout.db"), "error")
	}); err != nil {
		t.Fatal(err)
	}
	checkoutSQL(t, "INSERT INTO users (id, clerk_user_id, email) VALUES ('buyer', 'clerk_buyer', 'buyer@example.com')")
	f := &checkoutFixture{live: map[string]string{}}
	backendServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/prices":
			_, _ = fmt.Fprint(w, `{"object":"list","data":[{"id":"price_test"}],"has_more":false}`)
		case "/v1/checkout/sessions":
			if err := r.ParseForm(); err != nil {
				t.Error(err)
			}
			f.forms = append(f.forms, r.PostForm)
			_, _ = fmt.Fprint(w, `{"id":"cs_test","url":"https://checkout.test/session"}`)
		default:
			if !strings.HasPrefix(r.URL.Path, "/v1/subscriptions/") {
				t.Errorf("unexpected Stripe request: %s", r.URL.Path)
				w.WriteHeader(404)
				return
			}
			id := strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/")
			state := f.live[id]
			if state == "" {
				w.WriteHeader(404)
				_, _ = fmt.Fprint(w, `{"error":{"type":"invalid_request_error","code":"resource_missing","message":"missing"}}`)
				return
			}
			_, _ = fmt.Fprintf(w, `{"id":%q,"status":%q,"cancel_at_period_end":%t}`, id, state, f.cancel)
		}
	}))
	t.Cleanup(backendServer.Close)
	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{URL: stripeSDK.String(backendServer.URL), HTTPClient: backendServer.Client(), MaxNetworkRetries: stripeSDK.Int64(0)})
	sc := stripeSDK.NewClient("sk_test_fake", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
	f.server = httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), sc, nil))
	t.Cleanup(f.server.Close)
	f.token = jwks.SignSessionToken(t, jwt.MapClaims{"sub": "clerk_buyer", "email": "buyer@example.com"})
	return f
}

func checkoutSQL(t *testing.T, query string, args ...any) {
	t.Helper()
	if err := sqlitex.DB.Exec(query, args...).Error; err != nil {
		t.Fatal(err)
	}
}

func checkoutSub(t *testing.T, id, stored, classification, resolution string) {
	t.Helper()
	checkoutSQL(t, "INSERT INTO subscriptions (stripe_subscription_id,user_id,stripe_customer_id,status,classification,conflict_status,created_at,updated_at) VALUES (?, 'buyer', 'cus_accepted', ?, ?, ?, 1, 1)", id, stored, classification, resolution)
	if classification == "accepted" {
		checkoutSQL(t, "UPDATE users SET accepted_subscription_id = ? WHERE id = 'buyer'", id)
	}
}

func (f *checkoutFixture) post(t *testing.T, endpoint string) (int, map[string]any) {
	t.Helper()
	payload := `{"tier":"small"}`
	if endpoint == "subscription" {
		payload = `{"plan":"pro"}`
	}
	req, err := http.NewRequest(http.MethodPost, f.server.URL+"/api/billing/checkout/"+endpoint, bytes.NewBufferString(payload))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+f.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, body
}

func TestCheckoutCutoverReusesLatestOwnedCustomer(t *testing.T) {
	for _, endpoint := range []string{"subscription", "topup"} {
		t.Run(endpoint, func(t *testing.T) {
			f := checkoutRoute(t, true)
			checkoutSQL(t, "INSERT INTO stripe_customers (stripe_customer_id,user_id,created_at) VALUES ('cus_old','buyer',1), ('cus_latest','buyer',2)")
			code, body := f.post(t, endpoint)
			if code != 200 || body["success"] != true || len(f.forms) != 1 {
				t.Fatalf("response %d %v, sessions %v", code, body, f.forms)
			}
			if f.forms[0].Get("customer") != "cus_latest" {
				t.Fatalf("customer form = %v", f.forms[0])
			}
		})
	}
}

func TestCheckoutCutoverUsesLiveAcceptedState(t *testing.T) {
	for _, live := range []string{"active", "active scheduled", "canceled", "incomplete_expired", "trialing", "past_due", "unpaid", "incomplete"} {
		t.Run(live, func(t *testing.T) {
			f := checkoutRoute(t, true)
			// Deliberately stale: the stored state must not decide eligibility.
			stored := "active"
			if live == "active" {
				stored = "canceled"
			}
			checkoutSub(t, "sub_accepted", stored, "accepted", "")
			f.live["sub_accepted"] = live
			if live == "active scheduled" {
				f.live["sub_accepted"], f.cancel = "active", true
			}
			code, body := f.post(t, "subscription")
			want := 409
			sessions := 0
			if live == "canceled" || live == "incomplete_expired" {
				want, sessions = 200, 1
			}
			if code != want || body["success"] != (want == 200) || len(f.forms) != sessions {
				t.Fatalf("response %d %v, sessions %v", code, body, f.forms)
			}
		})
	}
}

func TestCheckoutCutoverBlockingConflictAndDeletion(t *testing.T) {
	for _, scenario := range []string{"open ended", "open live", "no accepted", "resolved ended", "resolved billable", "unknown resolved", "known beats unknown", "smallest actual blocker", "deletion priority"} {
		t.Run(scenario, func(t *testing.T) {
			f := checkoutRoute(t, true)
			checkoutSub(t, "sub_accepted", "canceled", "accepted", "")
			f.live["sub_accepted"] = "canceled"
			want, reason, id := 409, "subscription_conflict", "sub_z"
			switch scenario {
			case "open live", "no accepted":
				checkoutSub(t, "sub_z", "active", "conflict", "open")
				if scenario == "no accepted" {
					checkoutSQL(t, "UPDATE users SET accepted_subscription_id = NULL WHERE id = 'buyer'")
				}
			case "open ended":
				checkoutSub(t, "sub_z", "canceled", "conflict", "open")
			case "resolved ended":
				checkoutSub(t, "sub_z", "active", "conflict", "resolved")
				f.live["sub_z"] = "canceled"
				want, reason, id = 200, "", ""
			case "resolved billable":
				checkoutSub(t, "sub_z", "active", "conflict", "resolved")
				f.live["sub_z"] = "past_due"
			case "unknown resolved":
				checkoutSub(t, "sub_z", "active", "conflict", "resolved")
				want, reason, id = 503, "", ""
			case "known beats unknown":
				checkoutSub(t, "sub_z", "canceled", "conflict", "open")
				checkoutSub(t, "sub_a", "active", "conflict", "resolved")
			case "smallest actual blocker":
				checkoutSub(t, "sub_z", "canceled", "conflict", "open")
				checkoutSub(t, "sub_b", "active", "conflict", "resolved")
				checkoutSub(t, "sub_a", "active", "conflict", "resolved")
				f.live["sub_b"], f.live["sub_a"] = "active", "canceled"
				id = "sub_b"
				checkoutSQL(t, "UPDATE subscriptions SET created_at = 0 WHERE stripe_subscription_id = 'sub_z'")
			case "deletion priority":
				checkoutSQL(t, "INSERT INTO account_deletion_gates (user_id,state,started_at,updated_at) VALUES ('buyer','in_progress',1,1)")
				checkoutSub(t, "sub_z", "active", "conflict", "resolved")
				delete(f.live, "sub_accepted")
				reason, id = "deletion_in_progress", ""
			}
			code, body := f.post(t, "subscription")
			sessions := 0
			if want == 200 {
				sessions = 1
			}
			if code != want || body["success"] != (want == 200) || len(f.forms) != sessions {
				t.Fatalf("response %d %v, sessions %v", code, body, f.forms)
			}
			if reason != "" && body["reason"] != reason {
				t.Errorf("reason = %v, want %s", body, reason)
			}
			if id != "" && body["subscriptionId"] != id {
				t.Errorf("blocker = %v, want %s", body, id)
			}
			if id == "" && body["subscriptionId"] != nil {
				t.Errorf("unexpected subscriptionId: %v", body)
			}
			if reason == "subscription_conflict" && body["message"] != "Please contact billing support to resolve your subscription conflict." {
				t.Errorf("support message = %v", body)
			}
		})
	}
}

func TestCheckoutCutoverCustomerSelectionAndFailures(t *testing.T) {
	for _, endpoint := range []string{"subscription", "topup"} {
		for _, scenario := range []string{"empty ownership", "live accepted", "ended accepted", "owner failure", "subscription read failure", "gate read failure", "broken pointer", "live failure"} {
			t.Run(endpoint+"/"+scenario, func(t *testing.T) {
				f := checkoutRoute(t, true)
				want, customer := 200, ""
				if scenario != "empty ownership" {
					checkoutSQL(t, "INSERT INTO stripe_customers (stripe_customer_id,user_id,created_at) VALUES ('cus_accepted','buyer',1), ('cus_latest','buyer',2)")
					customer = "cus_latest"
				}
				switch scenario {
				case "live accepted", "ended accepted", "live failure":
					checkoutSub(t, "sub_accepted", "canceled", "accepted", "")
					switch scenario {
					case "live accepted":
						f.live["sub_accepted"] = "active"
						customer = "cus_accepted"
						if endpoint == "subscription" {
							want = 409
						}
					case "ended accepted":
						f.live["sub_accepted"] = "canceled"
					default:
						want = 503
					}
				case "subscription read failure":
					checkoutSQL(t, "DROP TABLE subscriptions")
					want = 503
				case "gate read failure":
					checkoutSQL(t, "DROP TABLE account_deletion_gates")
					want = 503
				case "broken pointer":
					checkoutSQL(t, "UPDATE users SET accepted_subscription_id = 'sub_missing' WHERE id = 'buyer'")
					want = 503
				case "owner failure":
					checkoutSQL(t, "DROP TABLE stripe_customers")
					want = 503
				}
				code, body := f.post(t, endpoint)
				if code != want || body["success"] != (want == 200) {
					t.Fatalf("response %d %v, want %d", code, body, want)
				}
				if want != 200 {
					if len(f.forms) != 0 {
						t.Fatalf("unexpected session/Customer creation: %v", f.forms)
					}
					return
				}
				if len(f.forms) != 1 || f.forms[0].Get("customer") != customer {
					t.Fatalf("forms = %v, want Customer %s", f.forms, customer)
				}
				form := f.forms[0]
				if customer == "" {
					if form.Get("customer_email") != "buyer@example.com" || (endpoint == "topup" && form.Get("customer_creation") != "always") {
						t.Fatalf("Customer creation = %v", form)
					}
				} else if form.Get("customer_creation") != "" || form.Get("customer_email") != "" {
					t.Fatalf("unexpected Customer creation = %v", form)
				}
			})
		}
	}
}
