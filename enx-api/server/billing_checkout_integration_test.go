//go:build integration

package server

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
}

func checkoutRoute(t *testing.T) *checkoutFixture {
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
			_, _ = fmt.Fprintf(w, `{"id":%q,"status":%q}`, id, state)
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

func TestCheckoutReusesTheLatestOwnedCustomer(t *testing.T) {
	for _, endpoint := range []string{"subscription", "topup"} {
		t.Run(endpoint, func(t *testing.T) {
			f := checkoutRoute(t)
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

func TestCheckoutAsksStripeWhetherTheAcceptedSubscriptionIsLive(t *testing.T) {
	f := checkoutRoute(t)
	checkoutSQL(t, "INSERT INTO subscriptions (stripe_subscription_id,user_id,stripe_customer_id,status,classification,created_at,updated_at) VALUES ('sub_accepted', 'buyer', 'cus_accepted', 'canceled', 'accepted', 1, 1)")
	checkoutSQL(t, "UPDATE users SET accepted_subscription_id = 'sub_accepted' WHERE id = 'buyer'")
	f.live["sub_accepted"] = "active"

	code, body := f.post(t, "subscription")

	if code != 409 || body["success"] != false || len(f.forms) != 0 {
		t.Fatalf("response %d %v, sessions %v; want 409 and no session", code, body, f.forms)
	}
}
