package main

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stripe/stripe-go/v86/webhook"

	"enx-api/config"
	"enx-api/metrics"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	stripeSDK "github.com/stripe/stripe-go/v86"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func billingStartupConfig(t *testing.T) *config.Config {
	t.Helper()
	gin.SetMode(gin.TestMode)
	cfg := config.Default()
	cfg.DB.Path = filepath.Join(t.TempDir(), "billing.db")
	cfg.Log.Level = "error"
	cfg.Billing.Cutover = true
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
	app, err := initializeApplication(context.Background(), cfg, metrics.New(), startupStripeClient(t))
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

func TestApplicationCutoverRestartsLegacyFixtureWithoutRestoringOldConstraints(t *testing.T) {
	restoreBillingDatabase(t)
	cfg := billingStartupConfig(t)
	seedLegacyStartupDatabase(t, cfg.DB.Path)
	client := startupStripeClient(t)
	first := startTestApplication(t, context.Background(), cfg, client)
	assertBillingMigrationOrder(t)
	if err := first.stopBilling(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		"INSERT INTO subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, created_at, updated_at) VALUES ('sub_second', 'u_subscribed', 'cus_subscribed', 'active', 1, 1)",
		"ALTER TABLE users DROP COLUMN avatar_url",
		"ALTER TABLE credit_accounts DROP COLUMN trial_expires_at",
		"ALTER TABLE credit_transactions DROP COLUMN note",
	} {
		if err := sqlitex.DB.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	closeCurrentStartupDatabase(t)
	second := startTestApplication(t, context.Background(), cfg, client)
	assertBillingMigrationOrder(t)
	for table, column := range map[string]string{"users": "avatar_url", "credit_accounts": "trial_expires_at", "credit_transactions": "note"} {
		if !sqlitex.DB.Migrator().HasColumn(table, column) {
			t.Errorf("%s.%s was excluded from AutoMigrate", table, column)
		}
	}
	if !sqlitex.DB.Migrator().HasColumn("users", "billing_version") {
		t.Error("lost users.billing_version")
	}
	if !sqlitex.DB.Migrator().HasIndex("credit_transactions", "idx_credit_transactions_subscription_invoice") {
		t.Error("lost subscription invoice uniqueness")
	}
	var count int64
	if err := sqlitex.DB.Raw("SELECT count(*) FROM subscriptions WHERE stripe_customer_id = 'cus_subscribed'").Scan(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("shared Customer subscriptions = %d, want 2", count)
	}
	if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id, stripe_customer_id, status, created_at, updated_at) VALUES ('sub_third', 'cus_subscribed', 'active', 1, 1)").Error; err != nil {
		t.Fatalf("Customer uniqueness was restored: %v", err)
	}
	if err := second.stopBilling(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func seedLegacyStartupDatabase(t *testing.T, path string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := sqlDB.Close(); err != nil {
			t.Error(err)
		}
	}()
	for _, fixture := range []string{"schema.sql", "subscribed.sql"} {
		for _, statement := range sqlStatements(t, fixture) {
			if err := db.Exec(statement).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
}

func startTestApplication(t *testing.T, ctx context.Context, cfg *config.Config, client *stripeSDK.Client) *application {
	t.Helper()
	previous := sqlitex.DB
	a, err := initializeApplication(ctx, cfg, metrics.New(), client)
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

func TestApplicationRefusesDisabledCutoverOnMigratedDatabaseWithoutWrites(t *testing.T) {
	restoreBillingDatabase(t)
	cfg := billingStartupConfig(t)
	a := startTestApplication(t, context.Background(), cfg, startupStripeClient(t))
	if err := a.stopBilling(context.Background()); err != nil {
		t.Fatal(err)
	}
	closeCurrentStartupDatabase(t)
	before, err := os.ReadFile(cfg.DB.Path)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Billing.Cutover = false
	stopped, err := initializeApplication(context.Background(), cfg, metrics.New(), nil)
	if err == nil || stopped != nil {
		t.Fatalf("disabled migrated startup = %v, %v", stopped, err)
	}
	for _, hint := range []string{"BILLING_CUTOVER", "backup"} {
		if !strings.Contains(err.Error(), hint) {
			t.Errorf("startup error lacks recovery hint %q: %v", hint, err)
		}
	}
	after, err := os.ReadFile(cfg.DB.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("refused startup modified the migrated database")
	}
}

func TestApplicationDisabledCutoverKeepsLegacyRoutesAndStartsNoWorkers(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(fmt.Sprintf("legacy=%v", legacy), func(t *testing.T) {
			restoreBillingDatabase(t)
			cfg := billingStartupConfig(t)
			cfg.Billing.Cutover = false
			if legacy {
				seedLegacyStartupDatabase(t, cfg.DB.Path)
			}
			a := startTestApplication(t, context.Background(), cfg, nil)
			if a.billing != nil {
				t.Fatal("disabled cutover started billing workers")
			}
			if sqlitex.DB.Migrator().HasTable("schema_migrations") {
				t.Fatal("disabled cutover ran billing migrations")
			}
			routes := map[string]bool{}
			for _, route := range a.router.Routes() {
				routes[route.Method+" "+route.Path] = true
			}
			for _, route := range []string{"POST /billing/webhook", "POST /api/billing/portal"} {
				if !routes[route] {
					t.Errorf("legacy route missing: %s", route)
				}
			}
			for _, route := range []string{"POST /api/billing/support", "POST /api/billing/portal/plan-change", "GET /api/admin/webhook-events"} {
				if routes[route] {
					t.Errorf("disabled cutover mounted new route: %s", route)
				}
			}
			w := httptest.NewRecorder()
			a.router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/billing/webhook", nil))
			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("unconfigured legacy billing = %d, want 503", w.Code)
			}
		})
	}
}
