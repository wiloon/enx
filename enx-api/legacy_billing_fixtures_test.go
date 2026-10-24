package main

// Legacy billing fixtures for #297 (ADR-067). testdata/billing-legacy holds
// the user-keyed billing schema as it stands before the subscription schema
// cutover, plus one SQL file of rows per kind of existing data the cutover's
// migration must handle. These tests pin the fixtures to today's schema and
// record what every subscription reader returns for them, so the cutover can
// rehearse its migration on the same rows and state, reader by reader, which
// answers it keeps and which it changes.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	accountadapters "enx-api/account/adapters"
	"enx-api/billing"
	"enx-api/config"
	"enx-api/dictionary"
	entadapters "enx-api/entitlement/adapters"
	"enx-api/repo"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	stripeSDK "github.com/stripe/stripe-go/v86"
)

const legacyBillingFixtureDir = "testdata/billing-legacy"

// legacyBillingTables are the tables schema.sql describes.
var legacyBillingTables = []string{"users", "subscriptions", "credit_accounts", "credit_transactions"}

// sqlStatements splits a fixture file into its statements, without comment
// lines or surrounding whitespace.
func sqlStatements(t *testing.T, name string) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(legacyBillingFixtureDir, name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var lines []string
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			lines = append(lines, line)
		}
	}
	var statements []string
	for _, s := range strings.Split(strings.Join(lines, "\n"), ";") {
		if s = strings.TrimSpace(s); s != "" {
			statements = append(statements, s)
		}
	}
	return statements
}

// schema.sql must be exactly the DDL today's models create, so a migration
// rehearsed on it starts from the schema production has.
func TestLegacyBillingSchemaFixtureMatchesTodaysSchema(t *testing.T) {
	sqlitex.Init(filepath.Join(t.TempDir(), "legacy-schema.db"))

	var live []string
	if err := sqlitex.DB.Raw(
		"SELECT sql FROM sqlite_master WHERE tbl_name IN ? AND sql IS NOT NULL", legacyBillingTables,
	).Scan(&live).Error; err != nil {
		t.Fatalf("read sqlite_master: %v", err)
	}
	fixture := sqlStatements(t, "schema.sql")
	sort.Strings(live)
	sort.Strings(fixture)
	if strings.Join(live, ";\n") != strings.Join(fixture, ";\n") {
		t.Fatalf("schema.sql differs from today's schema.\ntoday:\n%s\nfixture:\n%s",
			strings.Join(live, ";\n"), strings.Join(fixture, ";\n"))
	}
}

// legacyStripeFake answers what the readers ask Stripe: a subscription's
// status (subs, id -> status; unknown ids are resource_missing), price
// lookups, a safe Portal configuration, and Checkout/Portal session
// creation, recording the Customer each session was opened for.
type legacyStripeFake struct {
	subs map[string]string

	mu               sync.Mutex
	checkoutCustomer string
	portalCustomer   string
}

func (f *legacyStripeFake) client(t *testing.T) *stripeSDK.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/v1/subscriptions/"):
			id := strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/")
			status, ok := f.subs[id]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such subscription"}}`))
				return
			}
			_, _ = w.Write([]byte(`{"id":"` + id + `","object":"subscription","status":"` + status + `","cancel_at_period_end":false}`))
		case r.URL.Path == "/v1/prices":
			_, _ = w.Write([]byte(`{"object":"list","url":"/v1/prices","has_more":false,"data":[{"id":"price_pro","object":"price"}]}`))
		case r.URL.Path == "/v1/checkout/sessions":
			_ = r.ParseForm()
			f.checkoutCustomer = r.PostForm.Get("customer")
			_, _ = w.Write([]byte(`{"id":"cs_legacy","object":"checkout.session","url":"https://checkout.stripe.test/cs_legacy"}`))
		case r.URL.Path == "/v1/billing_portal/configurations/bpc_legacy":
			_, _ = w.Write([]byte(`{"id":"bpc_legacy","object":"billing_portal.configuration","active":true,"features":{"subscription_update":{"enabled":false}}}`))
		case r.URL.Path == "/v1/billing_portal/sessions":
			_ = r.ParseForm()
			f.portalCustomer = r.PostForm.Get("customer")
			_, _ = w.Write([]byte(`{"id":"bps_legacy","object":"billing_portal.session","url":"https://billing.stripe.test/bps_legacy"}`))
		default:
			t.Errorf("unexpected Stripe call: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{
		URL: stripeSDK.String(server.URL), HTTPClient: server.Client(), MaxNetworkRetries: stripeSDK.Int64(0),
	})
	return stripeSDK.NewClient("sk_test_legacy", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
}

// legacyReaderView is what each subscription reader answers for one user.
type legacyReaderView struct {
	// entitlement and the dictionary quota tier.
	ActiveSubscriber bool
	// dictionary's 429 copy for a subscriber.
	QuotaCopyForSubscriber bool
	// account deletion; RenewingErr is true when the check failed.
	Renewing, RenewingErr bool
	// the admin users page; AdminFound is false for a user without a users row.
	AdminFound                            bool
	AdminPlan, AdminStatus, AdminCustomer string
	// GET /billing/me.
	MeStatus, MePlan                      string
	MeSubscriptionBalance, MeTopupBalance int64
	// POST /billing/portal: the status and the Customer the session opened for.
	PortalCode     int
	PortalCustomer string
	// POST /billing/checkout/subscription: the status and the Customer reused.
	CheckoutCode     int
	CheckoutCustomer string
}

func loadLegacyBillingFixture(t *testing.T, name string) {
	t.Helper()
	sqlitex.Init(filepath.Join(t.TempDir(), "legacy-"+name+".db"))
	for _, statement := range sqlStatements(t, name+".sql") {
		if err := sqlitex.DB.Exec(statement).Error; err != nil {
			t.Fatalf("%s.sql: %v\n%s", name, err, statement)
		}
	}
}

func readLegacyView(t *testing.T, userID string, fake *legacyStripeFake, sc *stripeSDK.Client) legacyReaderView {
	t.Helper()
	ctx := context.Background()
	var v legacyReaderView
	var err error

	if v.ActiveSubscriber, err = (entadapters.Billing{}).IsActiveSubscriber(ctx, userID); err != nil {
		t.Fatalf("IsActiveSubscriber: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	dictionary.RespondQuotaExceeded(c, userID)
	v.QuotaCopyForSubscriber = strings.Contains(w.Body.String(), "unusually high for a subscription")

	v.Renewing, err = (accountadapters.Subscriptions{Stripe: sc}).Renewing(ctx, userID)
	v.RenewingErr = err != nil

	account, found, err := (repo.AdminUsers{Now: time.Now}).Account(ctx, userID)
	if err != nil {
		t.Fatalf("AdminUsers.Account: %v", err)
	}
	v.AdminFound, v.AdminPlan, v.AdminStatus, v.AdminCustomer = found, account.Plan, account.SubscriptionStatus, account.StripeCustomerID

	stripe := config.Default().Stripe
	stripe.PortalConfigurationID = "bpc_legacy"
	h := billing.NewHandler(sc, "https://example.com", stripe, nil)
	serve := func(method, path string, handler gin.HandlerFunc, body string) *httptest.ResponseRecorder {
		router := gin.New()
		router.Handle(method, path, func(c *gin.Context) { c.Set("user_id", userID) }, handler)
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	var me struct {
		Subscription struct{ Status, Plan string }
		Credits      struct{ SubscriptionBalance, TopupBalance int64 }
	}
	if err := json.Unmarshal(serve(http.MethodGet, "/billing/me", h.Me, "").Body.Bytes(), &me); err != nil {
		t.Fatalf("decode /billing/me: %v", err)
	}
	v.MeStatus, v.MePlan = me.Subscription.Status, me.Subscription.Plan
	v.MeSubscriptionBalance, v.MeTopupBalance = me.Credits.SubscriptionBalance, me.Credits.TopupBalance

	v.PortalCode = serve(http.MethodPost, "/billing/portal", h.Portal, "").Code
	v.CheckoutCode = serve(http.MethodPost, "/billing/checkout/subscription", h.CheckoutSubscription, `{"plan":"pro"}`).Code
	fake.mu.Lock()
	v.PortalCustomer, v.CheckoutCustomer = fake.portalCustomer, fake.checkoutCustomer
	fake.mu.Unlock()
	return v
}

// What every reader answers for each legacy fixture. Stripe's state is not
// in the database, so each case also says what Stripe reports for the
// subscriptions it holds.
func TestLegacyBillingFixtureReaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		fixture string
		stripe  map[string]string
		want    map[string]legacyReaderView
	}{
		{
			// A live subscriber: renews in Stripe and holds a period's credits.
			fixture: "subscribed",
			stripe:  map[string]string{"sub_subscribed": "active"},
			want: map[string]legacyReaderView{
				"u_subscribed": {
					ActiveSubscriber: true, QuotaCopyForSubscriber: true, Renewing: true,
					AdminFound: true, AdminPlan: "pro-plus", AdminStatus: "active", AdminCustomer: "cus_subscribed",
					MeStatus: "active", MePlan: "pro-plus", MeSubscriptionBalance: 500,
					PortalCode: http.StatusOK, PortalCustomer: "cus_subscribed",
					CheckoutCode: http.StatusConflict,
				},
			},
		},
		{
			// A subscription that ended: its row stays, with leftover credits.
			fixture: "ended",
			stripe:  map[string]string{"sub_ended": "canceled"},
			want: map[string]legacyReaderView{
				"u_ended": {
					AdminFound: true, AdminPlan: "pro", AdminStatus: "canceled", AdminCustomer: "cus_ended",
					MeStatus: "canceled", MePlan: "pro", MeSubscriptionBalance: 80,
					PortalCode: http.StatusOK, PortalCustomer: "cus_ended",
					CheckoutCode: http.StatusOK, CheckoutCustomer: "cus_ended",
				},
			},
		},
		{
			// A top-up-only buyer: a row holding just a Customer.
			fixture: "topup-only",
			want: map[string]legacyReaderView{
				"u_topup": {
					AdminFound: true, AdminStatus: "none", AdminCustomer: "cus_topup",
					MeStatus: "none", MeTopupBalance: 300,
					PortalCode: http.StatusOK, PortalCustomer: "cus_topup",
					CheckoutCode: http.StatusOK, CheckoutCustomer: "cus_topup",
				},
			},
		},
		{
			// A deleted account: users and credit_accounts are gone, the
			// subscription row and the ledger are kept.
			fixture: "deleted-user",
			stripe:  map[string]string{"sub_deleted": "canceled"},
			want: map[string]legacyReaderView{
				"u_deleted": {
					MeStatus: "canceled", MePlan: "pro",
					PortalCode: http.StatusOK, PortalCustomer: "cus_deleted",
					CheckoutCode: http.StatusUnauthorized,
				},
			},
		},
		{
			// #297's defect in the data: a second Checkout overwrote the
			// first subscription, which is still live in Stripe and whose
			// grant is still in the ledger. Readers see only the second.
			fixture: "overwritten-subscription",
			stripe:  map[string]string{"sub_first": "active", "sub_second": "active"},
			want: map[string]legacyReaderView{
				"u_overwritten": {
					ActiveSubscriber: true, QuotaCopyForSubscriber: true, Renewing: true,
					AdminFound: true, AdminPlan: "max", AdminStatus: "active", AdminCustomer: "cus_second",
					MeStatus: "active", MePlan: "max", MeSubscriptionBalance: 900,
					PortalCode: http.StatusOK, PortalCustomer: "cus_second",
					CheckoutCode: http.StatusConflict,
				},
			},
		},
		{
			// Rows a migration must stop on rather than guess about.
			fixture: "ambiguous",
			stripe:  map[string]string{"sub_legacy_plan": "active"},
			want: map[string]legacyReaderView{
				// "active" with no Subscription ID: entitlement counts a
				// subscriber, while deletion and Checkout see none.
				"u_active_without_subscription": {
					ActiveSubscriber: true, QuotaCopyForSubscriber: true,
					AdminFound: true, AdminPlan: "pro", AdminStatus: "active", AdminCustomer: "cus_active_without_subscription",
					MeStatus: "active", MePlan: "pro",
					PortalCode: http.StatusOK, PortalCustomer: "cus_active_without_subscription",
					CheckoutCode: http.StatusOK, CheckoutCustomer: "cus_active_without_subscription",
				},
				// A plan value from before the three tiers, passed through.
				"u_legacy_plan": {
					ActiveSubscriber: true, QuotaCopyForSubscriber: true, Renewing: true,
					AdminFound: true, AdminPlan: "monthly", AdminStatus: "active", AdminCustomer: "cus_legacy_plan",
					MeStatus: "active", MePlan: "monthly",
					PortalCode: http.StatusOK, PortalCustomer: "cus_legacy_plan",
					CheckoutCode: http.StatusConflict,
				},
				// A subscription grant in the ledger with no subscriptions
				// row: no Subscription ID to migrate.
				"u_ledger_without_subscription": {
					AdminFound: true,
					MeStatus:   "none", MeSubscriptionBalance: 100,
					PortalCode:   http.StatusNotFound,
					CheckoutCode: http.StatusOK,
				},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.fixture, func(t *testing.T) {
			loadLegacyBillingFixture(t, tc.fixture)
			for userID, want := range tc.want {
				fake := &legacyStripeFake{subs: tc.stripe}
				if got := readLegacyView(t, userID, fake, fake.client(t)); got != want {
					t.Errorf("%s:\n got  %+v\n want %+v", userID, got, want)
				}
			}
		})
	}
}
