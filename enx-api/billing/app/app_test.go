package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"enx-api/config"
	"enx-api/referral"

	"github.com/gin-gonic/gin"
	stripeSDK "github.com/stripe/stripe-go/v86"
)

type nopMailer struct{}

func (nopMailer) SendAdminAlert(context.Context, string, string) error { return nil }

// newTestClient is a Stripe client whose API backend is handler, with no
// network retries so a failing fake fails at once.
func newTestClient(t *testing.T, handler http.HandlerFunc) *stripeSDK.Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{
		URL:               stripeSDK.String(server.URL),
		HTTPClient:        server.Client(),
		MaxNetworkRetries: stripeSDK.Int64(0),
	})
	return stripeSDK.NewClient("sk_test_123", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
}

const (
	testPoll         = 5 * time.Second
	testNotifyPoll   = time.Hour
	testWebhookSecre = "whsec_test"
)

func testStripeConfig() config.Stripe {
	return config.Stripe{
		SecretKey:     "sk_test_123",
		WebhookSecret: testWebhookSecre,
		Price:         config.StripePrice{Pro: "pro_m", ProPlus: "pp_m", Max: "max_m"},
		Credits: config.StripeCredits{
			SubscriptionPro: 1000, SubscriptionProPlus: 5000, SubscriptionMax: 20000,
			TopupSmall: 500, TopupMedium: 2000, TopupLarge: 5000,
		},
		Webhook: config.StripeWebhook{
			PollInterval: testPoll, LeaseDuration: 2 * time.Minute, OperationTimeout: 5 * time.Second,
			BackoffMin: 5 * time.Second, BackoffMax: 15 * time.Minute, DependencyWaitDeadline: 24 * time.Hour,
			NotificationPollInterval: testNotifyPoll, NotificationTimeout: 5 * time.Second, NotificationLeaseDuration: 2 * time.Minute,
		},
	}
}

var tokenSeq atomic.Int64

func nextToken() string { return "tok_" + strconv.FormatInt(tokenSeq.Add(1), 10) }

// testDeps are valid Deps over client.
func testDeps(client *stripeSDK.Client) Deps {
	return Deps{
		Stripe:          testStripeConfig(),
		PortalReturnURL: "https://app.example.test/billing",
		Referral:        referral.FixedPolicy{},
		Client:          client,
		Mailer:          nopMailer{},
		Now:             time.Now,
		NewToken:        nextToken,
	}
}

func TestNewRejectsLocalMisconfigurationBeforeAnyStripeCall(t *testing.T) {
	var calls atomic.Int64
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	})
	cases := map[string]func(*Deps){
		"unknown API key prefix":  func(d *Deps) { d.Stripe.SecretKey = "rk_other_123" },
		"no signing secret":       func(d *Deps) { d.Stripe.WebhookSecret = "" },
		"no referral terms":       func(d *Deps) { d.Referral = nil },
		"no mailer":               func(d *Deps) { d.Mailer = nil },
		"no Stripe client":        func(d *Deps) { d.Client = nil },
		"zero poll interval":      func(d *Deps) { d.Stripe.Webhook.PollInterval = 0 },
		"timeout not below lease": func(d *Deps) { d.Stripe.Webhook.OperationTimeout = d.Stripe.Webhook.LeaseDuration },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			d := testDeps(client)
			mutate(&d)
			if a, err := New(d); err == nil || a != nil {
				t.Fatalf("New = %v, %v; want an error and no assembly", a, err)
			}
		})
	}
	if _, err := New(testDeps(client)); err != nil {
		t.Fatalf("New with valid deps: %v", err)
	}
	if n := calls.Load(); n != 0 {
		t.Errorf("construction made %d Stripe calls, want 0", n)
	}
}

func TestMountRegistersEachRouteRelativeToItsGroupAndInheritsItsMiddleware(t *testing.T) {
	a, err := New(testDeps(newTestClient(t, func(http.ResponseWriter, *http.Request) {})))
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	var userSeen, adminSeen atomic.Int64
	api := r.Group("/api", func(c *gin.Context) {
		if c.GetHeader("X-User") == "" {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		userSeen.Add(1)
		c.Set("user_id", c.GetHeader("X-User"))
	})
	admin := api.Group("/admin", func(c *gin.Context) {
		if c.GetHeader("X-Admin") == "" {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		adminSeen.Add(1)
	})
	a.Mount(api, admin, r)

	var got []string
	for _, route := range r.Routes() {
		got = append(got, route.Method+" "+route.Path)
	}
	sort.Strings(got)
	want := []string{
		"GET /api/admin/subscription-conflicts",
		"GET /api/admin/subscription-conflicts/:id",
		"GET /api/admin/webhook-events",
		"GET /api/admin/webhook-events/:id",
		"PATCH /api/admin/subscription-conflicts/:id",
		"POST /api/admin/webhook-events/:id/retry",
		"POST /api/billing/portal",
		"POST /api/billing/portal/plan-change",
		"POST /api/billing/support",
		"POST /billing/webhook",
	}
	sort.Strings(want)
	if len(got) != len(want) {
		t.Fatalf("routes = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("routes = %v, want %v", got, want)
		}
	}

	// Without the group's authentication every api and admin route refuses
	// before reaching a handler; a signed-in non-admin is refused on admin.
	do := func(method, path string, headers map[string]string) int {
		req := httptest.NewRequest(method, path, nil)
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec.Code
	}
	for _, route := range want[:9] {
		method, path, _ := strings.Cut(route, " ")
		if code := do(method, path, nil); code != http.StatusUnauthorized {
			t.Errorf("%s %s anonymous = %d, want 401", method, path, code)
		}
	}
	for _, path := range []string{"/api/admin/subscription-conflicts", "/api/admin/webhook-events/evt_1"} {
		if code := do(http.MethodGet, path, map[string]string{"X-User": "u1"}); code != http.StatusForbidden {
			t.Errorf("GET %s as non-admin = %d, want 403", path, code)
		}
	}
	if adminSeen.Load() != 0 {
		t.Error("the admin group's handlers ran for a non-admin")
	}
	// The webhook route is unauthenticated: a bad signature is a 400, not 401.
	if code := do(http.MethodPost, "/billing/webhook", nil); code != http.StatusBadRequest {
		t.Errorf("POST /billing/webhook without signature = %d, want 400", code)
	}
}
