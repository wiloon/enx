package billing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"enx-api/billing/acceptance"
	"enx-api/billing/checkout"
	"enx-api/billing/eligibility"
	"enx-api/billing/portalsession"
	"enx-api/repo"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	stripeSDK "github.com/stripe/stripe-go/v86"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
	"gorm.io/gorm"
)

func TestMain(m *testing.M) {
	dbPath := filepath.Join(os.TempDir(), "enx-billing-handler-test.db")
	_ = os.Remove(dbPath)
	sqlitex.Init(dbPath)
	gin.SetMode(gin.TestMode)
	os.Exit(m.Run())
}

// cleanupBillingUser removes fixture data and any rows written by the handler.
func cleanupBillingUser(t *testing.T, userID string) {
	t.Helper()
	t.Cleanup(func() {
		for _, table := range []string{"credit_transactions", "credit_accounts", "subscriptions", "trial_grants", "users"} {
			column := "user_id"
			if table == "users" {
				column = "id"
			}
			if err := sqlitex.DB.Exec("DELETE FROM "+table+" WHERE "+column+" = ?", userID).Error; err != nil {
				t.Errorf("clean up %s: %v", table, err)
			}
		}
	})
}

// setUserID simulates what middleware.ClerkAuth sets on the context.
func setUserID(userID string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	}
}

func doRequest(t *testing.T, method, path string, handler gin.HandlerFunc, userID, body string) *httptest.ResponseRecorder {
	t.Helper()
	router := gin.New()
	router.Handle(method, path, setUserID(userID), handler)

	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func TestCheckoutSubscriptionNotConfigured(t *testing.T) {
	h := newTestBillingHandler(nil, "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodPost, "/billing/checkout/subscription", h.CheckoutSubscription, "u1", `{"plan":"monthly"}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d want 503, body=%s", w.Code, w.Body.String())
	}
}

func TestCheckoutTopupNotConfigured(t *testing.T) {
	h := newTestBillingHandler(nil, "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodPost, "/billing/checkout/topup", h.CheckoutTopup, "u1", `{"tier":"small"}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d want 503, body=%s", w.Code, w.Body.String())
	}
}

// A client built from a well-formed-but-fake key never makes a network call
// in these tests: request validation always fails before CreateCheckoutSession
// would be reached.
func fakeConfiguredClient() *stripeSDK.Client {
	return stripeSDK.NewClient("sk_test_fake")
}

func TestCheckoutSubscriptionInvalidPlan(t *testing.T) {
	h := newTestBillingHandler(fakeConfiguredClient(), "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodPost, "/billing/checkout/subscription", h.CheckoutSubscription, "u1", `{"plan":"lifetime"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400, body=%s", w.Code, w.Body.String())
	}
}

func TestCheckoutTopupInvalidTier(t *testing.T) {
	h := newTestBillingHandler(fakeConfiguredClient(), "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodPost, "/billing/checkout/topup", h.CheckoutTopup, "u1", `{"tier":"huge"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400, body=%s", w.Code, w.Body.String())
	}
}

// The pre-2026-08-26 plan values ("monthly"/"annual") must no longer
// validate: the three-tier refactor replaced them with "pro"/"pro-plus"/"max".
func TestCheckoutSubscriptionRejectsLegacyPlanValues(t *testing.T) {
	h := newTestBillingHandler(fakeConfiguredClient(), "https://example.com", testStripe(), nil)
	for _, plan := range []string{"monthly", "annual"} {
		w := doRequest(t, http.MethodPost, "/billing/checkout/subscription", h.CheckoutSubscription, "u1", `{"plan":"`+plan+`"}`)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("plan=%q status: got %d want 400, body=%s", plan, w.Code, w.Body.String())
		}
	}
}

// fakeStripeClient points the Stripe SDK at a local httptest.Server that
// answers the two calls CreateCheckoutSession makes (price lookup by
// lookup_key, session create). onSession receives the session-create form.
func fakeStripeClient(t *testing.T, onSession func(form url.Values)) *stripeSDK.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/subscriptions/"):
			id := strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/")
			var status string
			if err := sqlitex.DB.Raw("SELECT status FROM subscriptions WHERE stripe_subscription_id=?", id).Scan(&status).Error; err != nil {
				t.Fatal(err)
			}
			_, _ = w.Write([]byte(`{"id":"` + id + `","object":"subscription","status":"` + status + `"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/prices":
			_, _ = w.Write([]byte(`{"object":"list","url":"/v1/prices","has_more":false,"data":[{"id":"price_topup_small","object":"price"}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/checkout/sessions":
			if err := r.ParseForm(); err != nil {
				t.Errorf("parse session form: %v", err)
			}
			onSession(r.PostForm)
			_, _ = w.Write([]byte(`{"id":"cs_test_1","object":"checkout.session","url":"https://checkout.stripe.test/c/pay/cs_test_1"}`))
		default:
			t.Errorf("unexpected Stripe call: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)

	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{
		URL:        stripeSDK.String(server.URL),
		HTTPClient: server.Client(),
	})
	return stripeSDK.NewClient("sk_test_fake", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
}

// A user with no subscription can buy a credit top-up: any credit balance
// unlocks AI translate, whatever its source (2026-08-26 decision,
// LAUNCH-CHECKLIST 2.1).
func TestCheckoutTopupWithoutSubscriptionCreatesPaymentSession(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	seedUser(t, userID)

	var form url.Values
	h := newTestBillingHandler(fakeStripeClient(t, func(f url.Values) { form = f }), "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodPost, "/billing/checkout/topup", h.CheckoutTopup, userID, `{"tier":"small"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	if !bytes.Contains(w.Body.Bytes(), []byte(`"url":"https://checkout.stripe.test/c/pay/cs_test_1"`)) {
		t.Fatalf("expected checkout url in body, got %s", w.Body.String())
	}
	if got := form.Get("mode"); got != "payment" {
		t.Errorf("mode: got %q want payment", got)
	}
	if got := form.Get("client_reference_id"); got != userID {
		t.Errorf("client_reference_id: got %q want %q", got, userID)
	}
	if got := form.Get("metadata[type]"); got != "topup" {
		t.Errorf("metadata[type]: got %q want topup", got)
	}
	if got := form.Get("metadata[tier]"); got != "small" {
		t.Errorf("metadata[tier]: got %q want small", got)
	}
}

// Stripe makes no customer for a payment-mode session unless asked, and the
// webhook needs one to record the user<->customer mapping.
func TestCheckoutTopupFirstTimeBuyerAsksStripeToCreateACustomer(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	seedUser(t, userID)

	var form url.Values
	h := newTestBillingHandler(fakeStripeClient(t, func(f url.Values) { form = f }), "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodPost, "/billing/checkout/topup", h.CheckoutTopup, userID, `{"tier":"small"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	if got := form.Get("customer_creation"); got != "always" {
		t.Errorf("customer_creation: got %q want always", got)
	}
	if got := form.Get("customer_email"); got != userID+"@example.com" {
		t.Errorf("customer_email: got %q want %s@example.com", got, userID)
	}
}

// A second live subscription would overwrite the first one's id in the
// user's single subscriptions row, orphaning it while Stripe keeps billing.
func TestCheckoutSubscriptionRefusesUserWithLiveSubscription(t *testing.T) {
	for _, status := range []string{"active", "trialing", "past_due"} {
		t.Run(status, func(t *testing.T) {
			userID := "u-" + t.Name()
			cleanupBillingUser(t, userID)
			seedUser(t, userID)
			seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, status, 1700000000)

			h := newTestBillingHandler(fakeStripeClient(t, func(url.Values) {
				t.Error("checkout session created for a user with a live subscription")
			}), "https://example.com", testStripe(), nil)
			w := doRequest(t, http.MethodPost, "/billing/checkout/subscription", h.CheckoutSubscription, userID, `{"plan":"pro"}`)
			if w.Code != http.StatusConflict {
				t.Fatalf("status: got %d want 409, body=%s", w.Code, w.Body.String())
			}
			if !bytes.Contains(w.Body.Bytes(), []byte(`"message":"You already have a subscription. Manage it from the billing portal."`)) {
				t.Fatalf("expected portal message, got %s", w.Body.String())
			}
		})
	}
}

// A user whose subscription ended, or who never had one, can subscribe.
func TestCheckoutSubscriptionAllowsUserWithoutLiveSubscription(t *testing.T) {
	cases := []struct {
		name   string
		status string // "" seeds no subscriptions row
	}{
		{"canceled", "canceled"},
		{"no row", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			userID := "u-" + t.Name()
			cleanupBillingUser(t, userID)
			seedUser(t, userID)
			if tc.status != "" {
				seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, tc.status, 1700000000)
			}

			var form url.Values
			h := newTestBillingHandler(fakeStripeClient(t, func(f url.Values) { form = f }), "https://example.com", testStripe(), nil)
			w := doRequest(t, http.MethodPost, "/billing/checkout/subscription", h.CheckoutSubscription, userID, `{"plan":"pro"}`)
			if w.Code != http.StatusOK {
				t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
			}
			if got := form.Get("mode"); got != "subscription" {
				t.Errorf("mode: got %q want subscription", got)
			}
		})
	}
}

// Without the subscription row the handler can't tell whether one is live, so
// it must not risk a second subscription by checking out anyway.
func TestCheckoutSubscriptionFailsWhenSubscriptionLookupFails(t *testing.T) {
	userID := "u-subscription-lookup-fails"
	cleanupBillingUser(t, userID)
	seedUser(t, userID)
	failSubscriptionQueries(t)

	h := newTestBillingHandler(fakeStripeClient(t, func(url.Values) {
		t.Error("checkout session created although the subscription lookup failed")
	}), "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodPost, "/billing/checkout/subscription", h.CheckoutSubscription, userID, `{"plan":"pro"}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d want 503, body=%s", w.Code, w.Body.String())
	}
	if !bytes.Contains(w.Body.Bytes(), []byte(`"message":"Billing is temporarily unavailable. Please retry."`)) {
		t.Fatalf("expected load failure message, got %s", w.Body.String())
	}
}

type fakeOwners struct {
	owner portalsession.Owner
	err   error
}

func (f fakeOwners) Owner(context.Context, string) (portalsession.Owner, error) {
	return f.owner, f.err
}

type fakeSubscriptions struct {
	sub portalsession.Subscription
	err error
}

func (f fakeSubscriptions) Subscription(context.Context, string) (portalsession.Subscription, error) {
	return f.sub, f.err
}

// checkoutHandler mounts the real checkout.Service over fake reads; it fails
// the test if a Checkout session is created.
func checkoutHandler(t *testing.T, owners fakeOwners, subs fakeSubscriptions) *Handler {
	t.Helper()
	sc := fakeStripeClient(t, func(url.Values) { t.Error("checkout session created") })
	return NewHandler(sc, "https://example.com", testStripe().Price, repo.BillingSubscriptions{}, checkout.New(owners, subs))
}

func observeLogs(t *testing.T) *observer.ObservedLogs {
	t.Helper()
	core, logs := observer.New(zap.DebugLevel)
	t.Cleanup(logger.Swap(zap.New(core).Sugar()))
	return logs
}

func decodeBody(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body %s: %v", w.Body.String(), err)
	}
	return body
}

// A Checkout that fails a required read answers 503 and leaves one error
// line saying whose Checkout failed, in which mode, and why.
func TestCheckoutLogsWhyItIsUnavailable(t *testing.T) {
	routes := []struct {
		mode, path, body string
		handler          func(*Handler) gin.HandlerFunc
	}{
		{"subscription", "/billing/checkout/subscription", `{"plan":"pro"}`, func(h *Handler) gin.HandlerFunc { return h.CheckoutSubscription }},
		{"topup", "/billing/checkout/topup", `{"tier":"small"}`, func(h *Handler) gin.HandlerFunc { return h.CheckoutTopup }},
	}
	causes := []struct {
		name   string
		owners fakeOwners
		subs   fakeSubscriptions
		cause  string
	}{
		{"owner read", fakeOwners{err: errors.New("owner read: disk I/O error")}, fakeSubscriptions{}, "owner read: disk I/O error"},
		{"accepted subscription read", fakeOwners{owner: portalsession.Owner{AcceptedID: "sub_accepted"}}, fakeSubscriptions{err: errors.New("stripe: connection reset")}, "stripe: connection reset"},
	}
	for _, route := range routes {
		for _, tc := range causes {
			t.Run(route.mode+"/"+tc.name, func(t *testing.T) {
				userID := "u-" + strings.ReplaceAll(t.Name(), "/", "-")
				cleanupBillingUser(t, userID)
				seedUser(t, userID)
				logs := observeLogs(t)

				h := checkoutHandler(t, tc.owners, tc.subs)
				w := doRequest(t, http.MethodPost, route.path, route.handler(h), userID, route.body)
				if w.Code != http.StatusServiceUnavailable {
					t.Fatalf("status: got %d want 503, body=%s", w.Code, w.Body.String())
				}
				want := map[string]any{"success": false, "message": "Billing is temporarily unavailable. Please retry."}
				if got := decodeBody(t, w); !reflect.DeepEqual(got, want) {
					t.Fatalf("body: got %v want %v", got, want)
				}
				errorLines := logs.FilterLevelExact(zapcore.ErrorLevel).All()
				if len(errorLines) != 1 {
					t.Fatalf("error lines: got %d want 1: %v", len(errorLines), errorLines)
				}
				msg := errorLines[0].Message
				for _, part := range []string{userID, route.mode, tc.cause} {
					if !strings.Contains(msg, part) {
						t.Errorf("error line %q does not name %q", msg, part)
					}
				}
			})
		}
	}
}

// Refusals are expected outcomes: they keep their 409 bodies and are not
// logged as errors.
func TestCheckoutRefusalsAreNotLoggedAsErrors(t *testing.T) {
	cases := []struct {
		name   string
		owners fakeOwners
		subs   fakeSubscriptions
		want   map[string]any
	}{
		{
			"deletion in progress",
			fakeOwners{owner: portalsession.Owner{Deletion: acceptance.DeletionInProgress}},
			fakeSubscriptions{},
			map[string]any{"success": false, "reason": "deletion_in_progress", "message": "Account deletion is in progress. Please retry later."},
		},
		{
			"subscription conflict",
			fakeOwners{owner: portalsession.Owner{Owned: []eligibility.Owned{{ID: "sub_conflict", Conflict: eligibility.ConflictOpen, StoredStatus: "active"}}}},
			fakeSubscriptions{},
			map[string]any{"success": false, "reason": "subscription_conflict", "subscriptionId": "sub_conflict", "message": "Please contact billing support to resolve your subscription conflict."},
		},
		{
			"accepted subscription",
			fakeOwners{owner: portalsession.Owner{AcceptedID: "sub_accepted", AcceptedCustomerID: "cus_accepted"}},
			fakeSubscriptions{sub: portalsession.Subscription{Live: eligibility.Live{Status: "active"}}},
			map[string]any{"success": false, "message": "You already have a subscription. Manage it from the billing portal."},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			userID := "u-" + strings.ReplaceAll(t.Name(), "/", "-")
			cleanupBillingUser(t, userID)
			seedUser(t, userID)
			logs := observeLogs(t)

			h := checkoutHandler(t, tc.owners, tc.subs)
			w := doRequest(t, http.MethodPost, "/billing/checkout/subscription", h.CheckoutSubscription, userID, `{"plan":"pro"}`)
			if w.Code != http.StatusConflict {
				t.Fatalf("status: got %d want 409, body=%s", w.Code, w.Body.String())
			}
			if got := decodeBody(t, w); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("body: got %v want %v", got, tc.want)
			}
			if n := logs.FilterLevelExact(zapcore.ErrorLevel).Len(); n != 0 {
				t.Fatalf("error lines: got %d want 0: %v", n, logs.All())
			}
		})
	}
}

// failSubscriptionQueries makes every read of the subscriptions table fail
// for the rest of the test; other tables still answer.
func failSubscriptionQueries(t *testing.T) {
	t.Helper()
	const name = "test:fail-subscription-queries"
	err := sqlitex.DB.Callback().Row().Before("gorm:row").Register(name, func(tx *gorm.DB) {
		if strings.Contains(tx.Statement.SQL.String(), "subscriptions") {
			_ = tx.AddError(errors.New("disk I/O error"))
		}
	})
	if err != nil {
		t.Fatalf("register callback: %v", err)
	}
	t.Cleanup(func() { _ = sqlitex.DB.Callback().Row().Remove(name) })
}

// seedUser creates the minimal users row enx.GetUserByID needs -- CheckoutTopup
// and CheckoutSubscription both 401 on an unknown user before reaching any
// billing-specific logic.
func seedUser(t *testing.T, userID string) {
	t.Helper()
	if err := sqlitex.DB.Exec(
		"INSERT INTO users (id, name, email, status, created_at, updated_at) VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'))",
		userID, userID, userID+"@example.com",
	).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
}

func TestMeDefaultsForUnknownUser(t *testing.T) {
	h := newTestBillingHandler(nil, "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodGet, "/billing/me", h.Me, "u-brand-new", ``)
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !bytes.Contains(w.Body.Bytes(), []byte(`"status":"none"`)) {
		t.Fatalf("expected status none, got %s", body)
	}
}

func TestMeReflectsExistingRows(t *testing.T) {
	userID := "u-with-subscription"
	cleanupBillingUser(t, userID)
	seedUser(t, userID)
	seedSubscription(t, userID, "cus_123", "sub_me", "active", 1700000000)
	credit := sqlitex.CreditAccount{
		UserId:              userID,
		SubscriptionBalance: 100,
		TopupBalance:        50,
		UpdatedAt:           1,
	}
	if err := sqlitex.DB.Create(&credit).Error; err != nil {
		t.Fatalf("seed credit account: %v", err)
	}

	h := newTestBillingHandler(nil, "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodGet, "/billing/me", h.Me, userID, ``)
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	if !bytes.Contains(w.Body.Bytes(), []byte(`"status":"active"`)) {
		t.Fatalf("expected active status, got %s", w.Body.String())
	}
	if !bytes.Contains(w.Body.Bytes(), []byte(`"subscriptionBalance":100`)) {
		t.Fatalf("expected subscriptionBalance 100, got %s", w.Body.String())
	}
	if !bytes.Contains(w.Body.Bytes(), []byte(`"topupBalance":50`)) {
		t.Fatalf("expected topupBalance 50, got %s", w.Body.String())
	}

}
