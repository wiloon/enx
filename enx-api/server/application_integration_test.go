//go:build integration

package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stripe/stripe-go/v86/webhook"

	"enx-api/config"
	"enx-api/metrics"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	stripeSDK "github.com/stripe/stripe-go/v86"
)

func billingStartupConfig(t *testing.T) *config.Config {
	t.Helper()
	gin.SetMode(gin.TestMode)
	cfg := config.Default()
	cfg.DB.Path = filepath.Join(t.TempDir(), "billing.db")
	cfg.Log.Level = "error"

	cfg.Stripe.SecretKey = "sk_test_startup"
	cfg.Stripe.WebhookSecret = "whsec_startup"
	cfg.App.FrontendBaseURL = "https://app.example.test"
	return cfg
}

func startupStripeClient(t *testing.T) *stripeSDK.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(server.Close)
	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{
		URL: stripeSDK.String(server.URL), HTTPClient: server.Client(), MaxNetworkRetries: stripeSDK.Int64(0),
	})
	return stripeSDK.NewClient("sk_test_startup", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
}

func TestApplicationCutoverStartsFreshAndMountsDurableBilling(t *testing.T) {
	restoreBillingDatabase(t)
	cfg := billingStartupConfig(t)
	previous := sqlitex.DB
	app, err := Initialize(context.Background(), cfg, metrics.New(), startupStripeClient(t))
	closeNewBillingDatabase(t, previous)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := app.billing.stop(ctx); err != nil {
			t.Error(err)
		}
	})
	assertBillingMigrationOrder(t)
	routes := map[string]bool{}
	for _, route := range app.router.Routes() {
		routes[route.Method+" "+route.Path] = true
	}
	for _, route := range []string{
		"POST /billing/webhook", "POST /api/billing/portal", "POST /api/billing/portal/plan-change",
		"POST /api/billing/support", "GET /api/admin/webhook-events", "GET /api/admin/subscription-conflicts",
	} {
		if !routes[route] {
			t.Errorf("missing route %s", route)
		}
	}
	w := httptest.NewRecorder()
	payload := []byte(`{"id":"evt_startup","object":"event","type":"invoice.paid","created":1700000000,"livemode":false,"data":{"object":{"id":"in_startup","object":"invoice"}}}`)
	signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: cfg.Stripe.WebhookSecret.Reveal()})
	req := httptest.NewRequest(http.MethodPost, "/billing/webhook", strings.NewReader(string(payload)))
	req.Header.Set("Stripe-Signature", signed.Header)
	app.router.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("undiscovered durable receiver = %d, want 503: %s", w.Code, w.Body.String())
	}
}

func TestApplicationRestartsOnItsOwnDatabase(t *testing.T) {
	restoreBillingDatabase(t)
	cfg := billingStartupConfig(t)
	client := startupStripeClient(t)
	first := startTestApplication(t, context.Background(), cfg, client)
	if err := first.stopBilling(context.Background()); err != nil {
		t.Fatal(err)
	}
	closeCurrentStartupDatabase(t)
	second := startTestApplication(t, context.Background(), cfg, client)
	assertBillingMigrationOrder(t)
	if err := second.stopBilling(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func startTestApplication(t *testing.T, ctx context.Context, cfg *config.Config, client *stripeSDK.Client) *Application {
	t.Helper()
	previous := sqlitex.DB
	a, err := Initialize(ctx, cfg, metrics.New(), client)
	closeNewBillingDatabase(t, previous)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		shutdown, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := a.stopBilling(shutdown); err != nil {
			t.Error(err)
		}
	})
	return a
}

func closeCurrentStartupDatabase(t *testing.T) {
	t.Helper()
	db, err := sqlitex.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
}
