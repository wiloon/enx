//go:build integration

package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stripe/stripe-go/v86/webhook"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// newBillingDB opens a temporary database as the cutover leaves it, with the
// rows of the named testdata/billing-legacy fixtures, and makes it the
// package-wide one.
func newBillingDB(t *testing.T, fixtures ...string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "enx.db")), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	for _, name := range append([]string{"schema.sql"}, fixtures...) {
		raw, err := os.ReadFile(filepath.Join("../../testdata/billing-legacy", name))
		if err != nil {
			t.Fatal(err)
		}
		var lines []string
		for _, line := range strings.Split(string(raw), "\n") {
			if !strings.HasPrefix(strings.TrimSpace(line), "--") {
				lines = append(lines, line)
			}
		}
		for _, stmt := range strings.Split(strings.Join(lines, "\n"), ";") {
			if stmt = strings.TrimSpace(stmt); stmt != "" {
				if err := db.Exec(stmt).Error; err != nil {
					t.Fatalf("legacy %s: %v", name, err)
				}
			}
		}
	}
	if _, err := sqlitex.MigrateSubscriptionOwnership(db); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlitex.MigrateWebhookReceipts(db); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlitex.MigrateCreditProvenance(db); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlitex.MigrateDeletionGates(db); err != nil {
		t.Fatal(err)
	}
	prev := sqlitex.DB
	sqlitex.DB = db
	t.Cleanup(func() { sqlitex.DB = prev })
}

// fakeStripe is the Stripe API as the startup sequence sees it; each flag
// makes one part of it fail.
type fakeStripe struct {
	accountFails      atomic.Bool
	pricesFail        atomic.Bool
	invoicesFail      atomic.Bool
	accountCalls      atomic.Int64
	sessionsMade      atomic.Int64
	portalSafe        atomic.Bool
	subscriptionReply func(string) string
	subscriptionFails atomic.Bool
}

func (f *fakeStripe) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fail := func() {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"message":"down"}}`))
	}
	if f.subscriptionFails.Load() && strings.HasPrefix(r.URL.Path, "/v1/subscriptions/") {
		fail()
		return
	}
	if f.subscriptionReply != nil && strings.HasPrefix(r.URL.Path, "/v1/subscriptions/") {
		_, _ = w.Write([]byte(f.subscriptionReply(strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/"))))
		return
	}
	switch {
	case r.URL.Path == "/v1/account":
		f.accountCalls.Add(1)
		if f.accountFails.Load() {
			fail()
			return
		}
		_, _ = w.Write([]byte(`{"id":"acct_1","object":"account"}`))
	case r.URL.Path == "/v1/prices":
		if f.pricesFail.Load() {
			fail()
			return
		}
		key := r.URL.Query().Get("lookup_keys[0]")
		_, _ = w.Write([]byte(`{"object":"list","url":"/v1/prices","has_more":false,"data":[{"id":"price_` + key + `","object":"price"}]}`))
	case strings.HasPrefix(r.URL.Path, "/v1/billing_portal/configurations"):
		_ = json.NewEncoder(w).Encode(map[string]any{
			"object": "list", "has_more": false, "data": []any{map[string]any{
				"id": "bpc_plan", "object": "billing_portal.configuration", "active": true, "is_default": true,
				"features": map[string]any{
					"subscription_cancel":   map[string]any{"enabled": true, "mode": "at_period_end"},
					"payment_method_update": map[string]any{"enabled": true},
					"invoice_history":       map[string]any{"enabled": true},
					"subscription_update": map[string]any{
						"enabled": f.portalSafe.Load(), "proration_behavior": "always_invoice",
						"default_allowed_updates": []string{"price"},
						"schedule_at_period_end":  map[string]any{"conditions": []any{map[string]any{"type": "decreasing_item_amount"}}},
						"products": []any{
							map[string]any{"product": "prod_pro", "prices": []string{"price_pro_m"}},
							map[string]any{"product": "prod_pp", "prices": []string{"price_pp_m"}},
							map[string]any{"product": "prod_max", "prices": []string{"price_max_m"}},
						},
					},
				},
			}},
		})
	case strings.HasPrefix(r.URL.Path, "/v1/billing_portal/sessions"):
		f.sessionsMade.Add(1)
		if err := r.ParseForm(); err != nil {
			fail()
			return
		}
		if r.Form.Get("customer") != "cus_topup" || r.Form.Get("configuration") != "bpc_plan" || r.Form.Get("return_url") != "https://app.example.test/billing" {
			fail()
			return
		}
		_, _ = w.Write([]byte(`{"id":"bps_1","object":"billing_portal.session","url":"https://billing.example.test/session"}`))
	case r.URL.Path == "/v1/subscriptions/sub_recovery":
		_, _ = w.Write([]byte(`{"id":"sub_recovery","object":"subscription","status":"active","customer":"cus_topup","items":{"object":"list","has_more":false,"data":[{"id":"si_checkout","current_period_end":1800000000,"price":{"id":"price_pp_m"}}]}}`))
	case r.URL.Path == "/v1/subscriptions/sub_conflict_a":
		_, _ = w.Write([]byte(`{"id":"sub_conflict_a","object":"subscription","status":"active","customer":"cus_topup","items":{"object":"list","has_more":false,"data":[{"id":"si_a","current_period_end":1800000000,"price":{"id":"price_pp_m"}}]}}`))
	case r.URL.Path == "/v1/subscriptions/sub_conflict":
		_, _ = w.Write([]byte(`{"id":"sub_conflict","object":"subscription","status":"active","customer":"cus_topup","items":{"object":"list","has_more":false,"data":[{"id":"si_conflict","current_period_end":1800000000,"price":{"id":"price_pp_m"}}]}}`))
	case strings.HasPrefix(r.URL.Path, "/v1/invoice"):
		if f.invoicesFail.Load() {
			fail()
			return
		}
		_, _ = w.Write([]byte(`{"object":"list","url":"` + r.URL.Path + `","has_more":false,"data":[]}`))
	default:
		fail()
	}
}

type reports struct {
	mu    sync.Mutex
	steps []string
}

func (r *reports) report(step string, _ error) {
	r.mu.Lock()
	r.steps = append(r.steps, step)
	r.mu.Unlock()
}

func (r *reports) count(step string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, s := range r.steps {
		if s == step {
			n++
		}
	}
	return n
}

// rig is a started assembly over fake Stripe, a fake clock-less ticker set and a
// migrated database.
type rig struct {
	stripe  *fakeStripe
	tickers *fakeTickers
	reports *reports
	a       *Assembly
	router  *gin.Engine
	cancel  context.CancelFunc
}

func newRig(t *testing.T, fixtures ...string) *rig {
	t.Helper()
	return newRigWithDeps(t, func(*Deps) {}, fixtures...)
}

func newRigWithDeps(t *testing.T, configure func(*Deps), fixtures ...string) *rig {
	t.Helper()
	newBillingDB(t, fixtures...)
	r := &rig{stripe: &fakeStripe{}, tickers: newFakeTickers(), reports: &reports{}}
	d := testDeps(newTestClient(t, r.stripe.ServeHTTP))
	d.Ticker = r.tickers.Ticker
	d.Report = r.reports.report
	configure(&d)
	a, err := New(d)
	if err != nil {
		t.Fatal(err)
	}
	r.a = a
	gin.SetMode(gin.TestMode)
	r.router = gin.New()
	api := r.router.Group("/api", func(c *gin.Context) { c.Set("user_id", c.GetHeader("X-User")) })
	admin := api.Group("/admin", func(c *gin.Context) {
		if c.GetHeader("X-Admin") == "" {
			c.AbortWithStatus(http.StatusForbidden)
		}
	})
	a.Mount(api, admin, r.router)
	return r
}

func (r *rig) start(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	t.Cleanup(func() {
		cancel()
		select {
		case <-r.a.Done():
		case <-time.After(5 * time.Second):
			t.Error("the assembly's goroutines did not stop")
		}
	})
	begun := time.Now()
	if err := r.a.Start(ctx); err != nil {
		t.Fatal(err)
	}
	if time.Since(begun) > time.Second {
		t.Errorf("Start took %v, want it to return promptly", time.Since(begun))
	}
}

// deliver posts a signed event and returns the HTTP status.
func (r *rig) deliver(t *testing.T, eventID, eventType, object string) int {
	t.Helper()
	payload := `{"id":"` + eventID + `","object":"event","type":"` + eventType + `","created":1790000000,` +
		`"api_version":"2026-08-26.dahlia","livemode":false,"data":{"object":` + object + `}}`
	signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{
		Payload: []byte(payload), Secret: testWebhookSecre, Timestamp: time.Now(),
	})
	req := httptest.NewRequest(http.MethodPost, "/billing/webhook", bytes.NewReader(signed.Payload))
	req.Header.Set("Stripe-Signature", signed.Header)
	rec := httptest.NewRecorder()
	r.router.ServeHTTP(rec, req)
	return rec.Code
}

func eventStatus(t *testing.T, eventID string) (status string, attempts int64) {
	t.Helper()
	var row struct {
		Status   string
		Attempts int64
	}
	if err := sqlitex.DB.Raw("SELECT status, attempts FROM stripe_webhook_events WHERE event_id = ?", eventID).Scan(&row).Error; err != nil {
		t.Fatal(err)
	}
	return row.Status, row.Attempts
}

func countRows(t *testing.T, table string) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Raw("SELECT count(*) FROM " + table).Scan(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

const ignorableObject = `{"object":"customer","id":"cus_1"}`

func TestReceiptAnswers503UntilDiscoverySucceedsOnARetryTick(t *testing.T) {
	r := newRig(t)
	r.stripe.accountFails.Store(true)
	r.start(t)
	eventually(t, "the first discovery attempt", func() bool { return r.reports.count("endpoint discovery") >= 1 })

	if code := r.deliver(t, "evt_early", "customer.created", ignorableObject); code != http.StatusServiceUnavailable {
		t.Fatalf("receipt before discovery = %d, want 503", code)
	}
	if n := countRows(t, "stripe_webhook_deliveries") + countRows(t, "stripe_webhook_events"); n != 0 {
		t.Fatalf("%d rows written before discovery, want none", n)
	}

	r.stripe.accountFails.Store(false)
	r.tickers.tick(testPoll)
	eventually(t, "receipt to accept a delivery", func() bool {
		return r.deliver(t, "evt_late", "customer.created", ignorableObject) == http.StatusOK
	})
	if n := countRows(t, "stripe_webhook_deliveries"); n < 1 {
		t.Errorf("deliveries = %d, want at least 1", n)
	}
}

func TestATierPriceFailureLeavesTheWorkerStoppedUntilRecovery(t *testing.T) {
	r := newRig(t, "topup-only.sql")
	r.stripe.pricesFail.Store(true)
	r.start(t)
	eventually(t, "the failed price resolution report", func() bool { return r.reports.count("tier price resolution") >= 1 })

	if code := r.deliver(t, "evt_queued", "invoice.paid", `{"object":"invoice","id":"in_recovery","customer":"cus_topup","billing_reason":"subscription_create","amount_paid":0,"parent":{"subscription_details":{"subscription":"sub_recovery","metadata":{"enx_user_id":"u_topup"}}},"lines":{"has_more":false,"data":[{"id":"il_recovery","amount":0,"parent":{"subscription_item_details":{"subscription":"sub_recovery","subscription_item":"si_recovery","proration":false}},"pricing":{"price_details":{"price":"price_pp_m"}},"period":{"start":1790000000,"end":1800000000}}]}}`); code != http.StatusOK {
		t.Fatalf("receipt with prices unresolved = %d, want 200", code)
	}
	if status, attempts := eventStatus(t, "evt_queued"); status != "pending" || attempts != 0 {
		t.Fatalf("queued event = %s/%d, want untouched pending/0", status, attempts)
	}

	r.stripe.pricesFail.Store(false)
	r.tickers.tick(testPoll)
	eventually(t, "the worker to process the queued event", func() bool {
		status, _ := eventStatus(t, "evt_queued")
		return status == "processed"
	})
	var grant struct {
		Tier   string
		Amount int64
	}
	if err := sqlitex.DB.Raw("SELECT tier, amount FROM credit_transactions WHERE stripe_invoice_id = 'in_recovery'").Scan(&grant).Error; err != nil {
		t.Fatal(err)
	}
	if grant.Tier != "pro-plus" || grant.Amount != 5000 {
		t.Fatalf("recovered invoice grant = %+v, want pro-plus/5000", grant)
	}
	var balance int64
	if err := sqlitex.DB.Raw("SELECT subscription_balance FROM credit_accounts WHERE user_id = 'u_topup'").Scan(&balance).Error; err != nil {
		t.Fatal(err)
	}
	if balance != 5000 {
		t.Errorf("subscription balance = %d, want 5000", balance)
	}
}

func TestAnUnsafePortalIsReportedWhileReceiptAndWorkerProceed(t *testing.T) {
	r := newRig(t, "topup-only.sql")
	// The fake starts with unsafe Portal plan switching.
	r.start(t)
	eventually(t, "the portal report", func() bool { return r.reports.count("portal plan-change configuration") >= 1 })

	if code := r.deliver(t, "evt_ok", "customer.created", ignorableObject); code != http.StatusOK {
		t.Fatalf("receipt = %d, want 200", code)
	}
	r.tickers.tick(testPoll)
	eventually(t, "the worker to process the event", func() bool {
		status, _ := eventStatus(t, "evt_ok")
		return status == "ignored"
	})
	portal := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/billing/portal", nil)
		req.Header.Set("X-User", "u_topup")
		rec := httptest.NewRecorder()
		r.router.ServeHTTP(rec, req)
		return rec
	}
	if rec := portal(); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("unsafe Portal = %d: %s, want 503", rec.Code, rec.Body.String())
	}
	if n := r.stripe.sessionsMade.Load(); n != 0 {
		t.Errorf("%d Portal sessions created, want 0", n)
	}
	r.stripe.portalSafe.Store(true)
	if rec := portal(); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "https://billing.example.test/session") {
		t.Fatalf("recovered Portal = %d: %s, want session URL", rec.Code, rec.Body.String())
	}
	if n := r.stripe.sessionsMade.Load(); n != 1 {
		t.Errorf("Portal sessions after recovery = %d, want 1", n)
	}
}

func TestABackfillFailureGatesInvoicesWhileOtherEventsProgressUntilARetryTickSucceeds(t *testing.T) {
	// subscribed.sql leaves one legacy grant without provenance.
	r := newRig(t, "subscribed.sql")
	r.stripe.invoicesFail.Store(true)
	r.start(t)
	eventually(t, "the failed backfill report", func() bool { return r.reports.count("legacy provenance backfill") >= 1 })

	if code := r.deliver(t, "evt_inv", "invoice.paid", `{"object":"invoice","id":"in_1","customer":"cus_subscribed","parent":{"subscription_details":{"subscription":"sub_subscribed"}}}`); code != http.StatusOK {
		t.Fatalf("invoice receipt = %d", code)
	}
	if code := r.deliver(t, "evt_other", "customer.created", ignorableObject); code != http.StatusOK {
		t.Fatalf("other receipt = %d", code)
	}
	r.tickers.tick(testPoll)
	eventually(t, "the other event to progress", func() bool {
		status, _ := eventStatus(t, "evt_other")
		return status == "ignored"
	})
	if status, attempts := eventStatus(t, "evt_inv"); status != "pending" || attempts != 0 {
		t.Fatalf("gated invoice = %s/%d, want untouched pending/0", status, attempts)
	}

	r.stripe.invoicesFail.Store(false)
	r.tickers.tick(testPoll)
	eventually(t, "the backfill marker and the invoice to be claimed", func() bool {
		_, attempts := eventStatus(t, "evt_inv")
		return attempts > 0
	})
}

func TestCancellationStopsEveryGoroutineAndTicker(t *testing.T) {
	r := newRig(t)
	r.start(t)
	eventually(t, "the startup sequence", func() bool { return r.a.identity.Endpoint().AccountID != "" })

	r.cancel()
	select {
	case <-r.a.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("goroutines still running after cancellation")
	}
	if n := r.tickers.stoppedCount(); n != 2 {
		t.Errorf("stopped tickers = %d, want the poll and the notifier ticker", n)
	}
}

func TestStartRunsOnce(t *testing.T) {
	r := newRig(t)
	r.start(t)
	if err := r.a.Start(context.Background()); err == nil {
		t.Fatal("second Start succeeded, want an error")
	}
}

func TestMountedAdminRoutesServeAnAdminAndRefuseAnyoneElse(t *testing.T) {
	r := newRig(t, "subscribed.sql")
	r.start(t)
	eventually(t, "endpoint discovery", func() bool { return r.a.identity.Endpoint().AccountID != "" })
	get := func(path string, headers map[string]string) int {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		r.router.ServeHTTP(rec, req)
		return rec.Code
	}
	for _, path := range []string{"/api/admin/subscription-conflicts", "/api/admin/webhook-events"} {
		if code := get(path, map[string]string{"X-User": "u1", "X-Admin": "1"}); code != http.StatusOK {
			t.Errorf("GET %s as admin = %d, want 200", path, code)
		}
		if code := get(path, map[string]string{"X-User": "u1"}); code != http.StatusForbidden {
			t.Errorf("GET %s as non-admin = %d, want 403", path, code)
		}
	}
}

// fakeTickers hands out one hand-driven channel per interval and counts the
// tickers stopped.
type fakeTickers struct {
	mu      sync.Mutex
	chans   map[time.Duration]chan time.Time
	stopped int
}

func newFakeTickers() *fakeTickers { return &fakeTickers{chans: map[time.Duration]chan time.Time{}} }

func (f *fakeTickers) Ticker(d time.Duration) (<-chan time.Time, func()) {
	f.mu.Lock()
	defer f.mu.Unlock()
	ch, ok := f.chans[d]
	if !ok {
		ch = make(chan time.Time, 8)
		f.chans[d] = ch
	}
	return ch, func() {
		f.mu.Lock()
		f.stopped++
		f.mu.Unlock()
	}
}

func (f *fakeTickers) tick(d time.Duration) {
	f.mu.Lock()
	ch, ok := f.chans[d]
	f.mu.Unlock()
	if ok {
		ch <- time.Now()
	}
}

func (f *fakeTickers) stoppedCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.stopped
}
