package billing

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"enx-api/utils"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	stripeSDK "github.com/stripe/stripe-go/v86"
)

func TestMain(m *testing.M) {
	dbPath := filepath.Join(os.TempDir(), "enx-billing-handler-test.db")
	os.Remove(dbPath)
	os.Setenv("DB_PATH", dbPath)
	utils.ViperInit()
	sqlitex.Init()
	gin.SetMode(gin.TestMode)
	os.Exit(m.Run())
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
	h := NewHandler(nil, "https://example.com", "whsec_test")
	w := doRequest(t, http.MethodPost, "/billing/checkout/subscription", h.CheckoutSubscription, "u1", `{"plan":"monthly"}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d want 503, body=%s", w.Code, w.Body.String())
	}
}

func TestCheckoutTopupNotConfigured(t *testing.T) {
	h := NewHandler(nil, "https://example.com", "whsec_test")
	w := doRequest(t, http.MethodPost, "/billing/checkout/topup", h.CheckoutTopup, "u1", `{"tier":"small"}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d want 503, body=%s", w.Code, w.Body.String())
	}
}

func TestPortalNotConfigured(t *testing.T) {
	h := NewHandler(nil, "https://example.com", "whsec_test")
	w := doRequest(t, http.MethodPost, "/billing/portal", h.Portal, "u1", ``)
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
	h := NewHandler(fakeConfiguredClient(), "https://example.com", "whsec_test")
	w := doRequest(t, http.MethodPost, "/billing/checkout/subscription", h.CheckoutSubscription, "u1", `{"plan":"lifetime"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400, body=%s", w.Code, w.Body.String())
	}
}

func TestCheckoutTopupInvalidTier(t *testing.T) {
	h := NewHandler(fakeConfiguredClient(), "https://example.com", "whsec_test")
	w := doRequest(t, http.MethodPost, "/billing/checkout/topup", h.CheckoutTopup, "u1", `{"tier":"huge"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400, body=%s", w.Code, w.Body.String())
	}
}

// The pre-2026-08-26 plan values ("monthly"/"annual") must no longer
// validate: the three-tier refactor replaced them with "pro"/"pro-plus"/"max".
func TestCheckoutSubscriptionRejectsLegacyPlanValues(t *testing.T) {
	h := NewHandler(fakeConfiguredClient(), "https://example.com", "whsec_test")
	for _, plan := range []string{"monthly", "annual"} {
		w := doRequest(t, http.MethodPost, "/billing/checkout/subscription", h.CheckoutSubscription, "u1", `{"plan":"`+plan+`"}`)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("plan=%q status: got %d want 400, body=%s", plan, w.Code, w.Body.String())
		}
	}
}

// CheckoutTopup requires an existing active subscription (2026-08-26
// decision, see w10n-config/enx/monetization-tasks.md): AI credit top-ups
// must not be a free-tier way to buy AI translate without ever subscribing.
func TestCheckoutTopupRequiresActiveSubscription(t *testing.T) {
	userID := "u-" + t.Name()
	seedUser(t, userID)

	h := NewHandler(fakeConfiguredClient(), "https://example.com", "whsec_test")
	w := doRequest(t, http.MethodPost, "/billing/checkout/topup", h.CheckoutTopup, userID, `{"tier":"small"}`)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status: got %d want 403, body=%s", w.Code, w.Body.String())
	}
}

func TestCheckoutTopupPastDueSubscriptionIsRejected(t *testing.T) {
	userID := "u-" + t.Name()
	seedUser(t, userID)
	sub := sqlitex.Subscription{
		UserId:           userID,
		StripeCustomerId: "cus_past_due",
		Status:           "past_due",
		CreatedAt:        1,
		UpdatedAt:        1,
	}
	if err := sqlitex.DB.Create(&sub).Error; err != nil {
		t.Fatalf("seed subscription: %v", err)
	}

	h := NewHandler(fakeConfiguredClient(), "https://example.com", "whsec_test")
	w := doRequest(t, http.MethodPost, "/billing/checkout/topup", h.CheckoutTopup, userID, `{"tier":"small"}`)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status: got %d want 403, body=%s", w.Code, w.Body.String())
	}
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

func TestPortalNoBillingAccountYet(t *testing.T) {
	h := NewHandler(fakeConfiguredClient(), "https://example.com", "whsec_test")
	w := doRequest(t, http.MethodPost, "/billing/portal", h.Portal, "u-never-checked-out", ``)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status: got %d want 404, body=%s", w.Code, w.Body.String())
	}
}

func TestMeDefaultsForUnknownUser(t *testing.T) {
	h := NewHandler(nil, "https://example.com", "whsec_test")
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
	sub := sqlitex.Subscription{
		UserId:           userID,
		StripeCustomerId: "cus_123",
		Status:           "active",
		CurrentPeriodEnd: 1700000000,
		CreatedAt:        1,
		UpdatedAt:        1,
	}
	if err := sqlitex.DB.Create(&sub).Error; err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
	credit := sqlitex.CreditAccount{
		UserId:              userID,
		SubscriptionBalance: 100,
		TopupBalance:        50,
		UpdatedAt:           1,
	}
	if err := sqlitex.DB.Create(&credit).Error; err != nil {
		t.Fatalf("seed credit account: %v", err)
	}

	h := NewHandler(nil, "https://example.com", "whsec_test")
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

	// existingStripeCustomerID is what Portal uses to decide 404 vs.
	// proceeding to Stripe; verify it resolves the seeded row directly
	// rather than making a real network call.
	if got := existingStripeCustomerID(userID); got != "cus_123" {
		t.Fatalf("existingStripeCustomerID: got %q want %q", got, "cus_123")
	}
}
