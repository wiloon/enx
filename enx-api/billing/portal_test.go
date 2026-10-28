package billing

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	stripeSDK "github.com/stripe/stripe-go/v86"
)

// portalFake is a local Stripe for POST /billing/portal. configs answers
// GET /v1/billing_portal/configurations/{id}; listJSON answers the list
// (both the default query and the restricted metadata scan, told apart by
// is_default); subscriptions answers GET /v1/subscriptions/{id}; Prices
// resolve as price_<lookup_key>. Every read and session is recorded.
type portalFake struct {
	configs       map[string]string
	defaultList   string
	activeList    string
	listStatus    int
	subscriptions map[string]string
	subStatus     int

	configReads  []string
	defaultReads int
	activeReads  int
	subReads     []string
	sessions     []url.Values
}

func (f *portalFake) client(t *testing.T) *stripeSDK.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fail := func(status int) bool {
			if status == 0 || status == http.StatusOK {
				return false
			}
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"error":{"type":"api_error","message":"boom"}}`))
			return true
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/prices":
			key := r.URL.Query().Get("lookup_keys[0]")
			_, _ = w.Write([]byte(`{"object":"list","url":"/v1/prices","has_more":false,"data":[{"id":"price_` + key + `","object":"price"}]}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/billing_portal/configurations":
			if fail(f.listStatus) {
				return
			}
			data := f.activeList
			if r.URL.Query().Get("is_default") == "true" {
				f.defaultReads++
				data = f.defaultList
			} else {
				f.activeReads++
			}
			_, _ = w.Write([]byte(`{"object":"list","has_more":false,"data":[` + data + `]}`))
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/billing_portal/configurations/"):
			id := strings.TrimPrefix(r.URL.Path, "/v1/billing_portal/configurations/")
			f.configReads = append(f.configReads, id)
			body, ok := f.configs[id]
			if !ok {
				fail(http.StatusNotFound)
				return
			}
			_, _ = w.Write([]byte(body))
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/subscriptions/"):
			id := strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/")
			f.subReads = append(f.subReads, id)
			if fail(f.subStatus) {
				return
			}
			_, _ = w.Write([]byte(f.subscriptions[id]))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/billing_portal/sessions":
			if err := r.ParseForm(); err != nil {
				t.Errorf("parse portal session form: %v", err)
			}
			f.sessions = append(f.sessions, r.PostForm)
			_, _ = w.Write([]byte(`{"id":"bps_1","object":"billing_portal.session","url":"https://billing.stripe.test/p/session/bps_1"}`))
		default:
			t.Errorf("unexpected Stripe call: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{
		URL: stripeSDK.String(server.URL), HTTPClient: server.Client(), MaxNetworkRetries: stripeSDK.Int64(0),
	})
	return stripeSDK.NewClient("sk_test_fake", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
}

const commonPortalFeatures = `"invoice_history":{"enabled":true},"payment_method_update":{"enabled":true},"subscription_cancel":{"enabled":true,"mode":"at_period_end"}`

// planChangePortalConfiguration is a safe plan-change configuration over
// testStripe's tier Prices.
func planChangePortalConfiguration(id string, isDefault bool) string {
	p := testStripe().Price
	product := func(name, lookupKey string) string {
		return `{"product":"prod_` + name + `","prices":["price_` + lookupKey + `"],"adjustable_quantity":{"enabled":false}}`
	}
	def := "false"
	if isDefault {
		def = "true"
	}
	return `{"id":"` + id + `","object":"billing_portal.configuration","active":true,"is_default":` + def + `,"features":{` + commonPortalFeatures +
		`,"subscription_update":{"enabled":true,"default_allowed_updates":["price"],"proration_behavior":"always_invoice",` +
		`"schedule_at_period_end":{"conditions":[{"type":"decreasing_item_amount"}]},"products":[` +
		product("pro", p.Pro) + "," + product("plus", p.ProPlus) + "," + product("max", p.Max) + `]}}}`
}

func restrictedPortalConfiguration(id string) string {
	return `{"id":"` + id + `","object":"billing_portal.configuration","active":true,"metadata":{"enx_portal":"restricted"},"features":{` +
		commonPortalFeatures + `,"subscription_update":{"enabled":false}}}`
}

// healthyPortalFake resolves both configurations without overrides.
func healthyPortalFake() *portalFake {
	return &portalFake{
		defaultList: planChangePortalConfiguration("bpc_change", true),
		activeList:  planChangePortalConfiguration("bpc_change", true) + "," + restrictedPortalConfiguration("bpc_restricted"),
	}
}

func openPortal(t *testing.T, fake *portalFake, userID string, edit func(*Handler)) *httptest.ResponseRecorder {
	t.Helper()
	cfg := testStripe()
	cfg.PortalConfigurationID = ""
	cfg.PortalRestrictedConfigurationID = ""
	h := NewHandler(fake.client(t), "https://example.com", cfg, nil)
	if edit != nil {
		edit(h)
	}
	return doRequest(t, http.MethodPost, "/billing/portal", h.Portal, userID, ``)
}

func wantSession(t *testing.T, w *httptest.ResponseRecorder, fake *portalFake, customerID, configurationID string) {
	t.Helper()
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"url":"https://billing.stripe.test/p/session/bps_1"`)) {
		t.Fatalf("status = %d body = %s, want 200 with the session url", w.Code, w.Body.String())
	}
	if len(fake.sessions) != 1 {
		t.Fatalf("sessions created = %d, want 1", len(fake.sessions))
	}
	form := fake.sessions[0]
	if got := form.Get("configuration"); got != configurationID {
		t.Errorf("configuration = %q, want %s", got, configurationID)
	}
	if got := form.Get("customer"); got != customerID {
		t.Errorf("customer = %q, want %s", got, customerID)
	}
	if got := form.Get("return_url"); got != "https://example.com/billing" {
		t.Errorf("return_url = %q, want https://example.com/billing", got)
	}
}

func wantNoSession(t *testing.T, w *httptest.ResponseRecorder, fake *portalFake) {
	t.Helper()
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d body = %s, want 503", w.Code, w.Body.String())
	}
	if !bytes.Contains(w.Body.Bytes(), []byte(`"message":"The billing portal is unavailable right now. Please try again later."`)) {
		t.Errorf("body = %s, want the retryable portal message", w.Body.String())
	}
	if len(fake.sessions) != 0 {
		t.Errorf("sessions created = %d, want none", len(fake.sessions))
	}
}

// ADR-067: a healthy (Stripe active) subscriber's Portal home uses the
// checked plan-change configuration, pinned on the session.
func TestPortalGivesAnActiveSubscriberThePlanChangeConfiguration(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, "active", 1700000000)
	fake := healthyPortalFake()
	fake.subscriptions = map[string]string{"sub_" + userID: liveSubscription("sub_"+userID, "active", 1700000000)}

	w := openPortal(t, fake, userID, nil)

	wantSession(t, w, fake, "cus_"+userID, "bpc_change")
	if len(fake.subReads) != 1 || fake.subReads[0] != "sub_"+userID {
		t.Errorf("subscription reads = %v, want the live status of sub_%s", fake.subReads, userID)
	}
}

// A customer with no subscription (top-ups only) is not blocked.
func TestPortalGivesATopupOnlyCustomerThePlanChangeConfiguration(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	seedTopupOnlyCustomer(t, userID, "cus_"+userID)
	fake := healthyPortalFake()

	w := openPortal(t, fake, userID, nil)

	wantSession(t, w, fake, "cus_"+userID, "bpc_change")
	if len(fake.subReads) != 0 {
		t.Errorf("subscription reads = %v, want none", fake.subReads)
	}
}

// ADR-067 round 8: billable but not active subscribers can pay, change card
// or cancel, but every Portal session for them uses the restricted
// configuration. Stripe's live status decides, not the local row.
func TestPortalGivesAnUnhealthySubscriberTheRestrictedConfiguration(t *testing.T) {
	for _, status := range []string{"past_due", "unpaid", "incomplete", "trialing"} {
		t.Run(status, func(t *testing.T) {
			userID := "u-" + t.Name()
			cleanupBillingUser(t, userID)
			seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, "active", 1700000000)
			fake := healthyPortalFake()
			fake.subscriptions = map[string]string{"sub_" + userID: liveSubscription("sub_"+userID, status, 1700000000)}

			w := openPortal(t, fake, userID, nil)

			wantSession(t, w, fake, "cus_"+userID, "bpc_restricted")
		})
	}
}

// An ended subscription has nothing to switch; the user is not blocked.
func TestPortalGivesAnEndedSubscriberThePlanChangeConfiguration(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, "past_due", 1700000000)
	fake := healthyPortalFake()
	fake.subscriptions = map[string]string{"sub_" + userID: liveSubscription("sub_"+userID, "canceled", 1700000000)}

	w := openPortal(t, fake, userID, nil)

	wantSession(t, w, fake, "cus_"+userID, "bpc_change")
}

func TestPortalCreatesNoSessionWhenTheBlockingLookupFails(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, "active", 1700000000)
	fake := healthyPortalFake()
	fake.subStatus = http.StatusInternalServerError

	w := openPortal(t, fake, userID, nil)

	wantNoSession(t, w, fake)
}

// Explicit overrides are read alone, never the list, and pinned.
func TestPortalUsesTheConfiguredOverrides(t *testing.T) {
	for _, tc := range []struct {
		status, want string
	}{{"active", "bpc_change_override"}, {"past_due", "bpc_restricted_override"}} {
		t.Run(tc.status, func(t *testing.T) {
			userID := "u-" + t.Name()
			cleanupBillingUser(t, userID)
			seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, "active", 1700000000)
			fake := &portalFake{
				configs: map[string]string{
					"bpc_change_override":     planChangePortalConfiguration("bpc_change_override", false),
					"bpc_restricted_override": strings.Replace(restrictedPortalConfiguration("bpc_restricted_override"), `"enx_portal":"restricted"`, ``, 1),
				},
				subscriptions: map[string]string{"sub_" + userID: liveSubscription("sub_"+userID, tc.status, 1700000000)},
			}

			w := openPortal(t, fake, userID, func(h *Handler) {
				h.portalConfigurationID = "bpc_change_override"
				h.portalRestrictedConfigurationID = "bpc_restricted_override"
			})

			wantSession(t, w, fake, "cus_"+userID, tc.want)
			if fake.defaultReads+fake.activeReads != 0 {
				t.Errorf("configuration list queries = %d, want none with an override", fake.defaultReads+fake.activeReads)
			}
		})
	}
}

// Neither configuration falls back to the other, and a missing, unreadable
// or unsafe one creates no session.
func TestPortalRefusesWithoutASafeConfiguration(t *testing.T) {
	unsafeDefault := strings.Replace(planChangePortalConfiguration("bpc_change", true), `"proration_behavior":"always_invoice"`, `"proration_behavior":"create_prorations"`, 1)
	cases := []struct {
		name   string
		status string
		edit   func(*portalFake)
	}{
		{name: "no plan-change default", status: "active", edit: func(f *portalFake) { f.defaultList = "" }},
		{name: "unsafe plan-change default", status: "active", edit: func(f *portalFake) { f.defaultList = unsafeDefault }},
		{name: "configuration lookup fails", status: "active", edit: func(f *portalFake) { f.listStatus = http.StatusForbidden }},
		{name: "no restricted configuration", status: "past_due", edit: func(f *portalFake) { f.activeList = planChangePortalConfiguration("bpc_change", true) }},
		{name: "restricted configuration has switching on", status: "past_due", edit: func(f *portalFake) {
			f.activeList = strings.Replace(restrictedPortalConfiguration("bpc_restricted"), `"subscription_update":{"enabled":false}`, `"subscription_update":{"enabled":true}`, 1)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			userID := "u-" + t.Name()
			cleanupBillingUser(t, userID)
			seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, "active", 1700000000)
			fake := healthyPortalFake()
			fake.subscriptions = map[string]string{"sub_" + userID: liveSubscription("sub_"+userID, tc.status, 1700000000)}
			tc.edit(fake)

			w := openPortal(t, fake, userID, nil)

			wantNoSession(t, w, fake)
		})
	}

	t.Run("an unreadable override never falls back to the default", func(t *testing.T) {
		userID := "u-" + t.Name()
		cleanupBillingUser(t, userID)
		seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, "active", 1700000000)
		fake := healthyPortalFake()
		fake.subscriptions = map[string]string{"sub_" + userID: liveSubscription("sub_"+userID, "active", 1700000000)}

		w := openPortal(t, fake, userID, func(h *Handler) { h.portalConfigurationID = "bpc_missing" })

		wantNoSession(t, w, fake)
		if fake.defaultReads != 0 {
			t.Errorf("default queries = %d, want none", fake.defaultReads)
		}
	})
}

// ADR-067: the Subscription carries its ENX owner (subscription metadata)
// as well as the Checkout Session's client_reference_id.
func TestSubscriptionCheckoutAttributesTheSubscriptionToTheUser(t *testing.T) {
	userID := "u-" + t.Name()
	cleanupBillingUser(t, userID)
	seedUser(t, userID)

	var form url.Values
	h := NewHandler(fakeStripeClient(t, func(f url.Values) { form = f }), "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodPost, "/billing/checkout/subscription", h.CheckoutSubscription, userID, `{"plan":"pro"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", w.Code, w.Body.String())
	}
	if got := form.Get("client_reference_id"); got != userID {
		t.Errorf("client_reference_id = %q, want %q", got, userID)
	}
	if got := form.Get("subscription_data[metadata][enx_user_id]"); got != userID {
		t.Errorf("subscription_data[metadata][enx_user_id] = %q, want %q", got, userID)
	}
}
