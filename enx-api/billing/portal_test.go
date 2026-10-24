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

// portalFake answers the Portal configuration read with configJSON (or
// configStatus when it is not 200) and records every session created.
type portalFake struct {
	configJSON   string
	configStatus int
	configReads  []string
	defaultJSON  string
	defaultReads []url.Values
	sessions     []url.Values
}

func (f *portalFake) client(t *testing.T) *stripeSDK.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/billing_portal/configurations":
			f.defaultReads = append(f.defaultReads, r.URL.Query())
			if f.configStatus != 0 && f.configStatus != http.StatusOK {
				w.WriteHeader(f.configStatus)
				_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"Unavailable"}}`))
				return
			}
			data := f.defaultJSON
			if data == "" {
				data = `{"object":"list","has_more":false,"data":[]}`
			}
			_, _ = w.Write([]byte(data))
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/billing_portal/configurations/"):
			f.configReads = append(f.configReads, strings.TrimPrefix(r.URL.Path, "/v1/billing_portal/configurations/"))
			if f.configStatus != 0 && f.configStatus != http.StatusOK {
				w.WriteHeader(f.configStatus)
				_, _ = w.Write([]byte(`{"error":{"type":"api_error","message":"boom"}}`))
				return
			}
			_, _ = w.Write([]byte(f.configJSON))
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

const (
	safePortalConfiguration    = `{"id":"bpc_safe","object":"billing_portal.configuration","active":true,"features":{"subscription_cancel":{"enabled":true},"subscription_update":{"enabled":false}}}`
	updatesPortalConfiguration = `{"id":"bpc_updates","object":"billing_portal.configuration","active":true,"features":{"subscription_cancel":{"enabled":true},"subscription_update":{"enabled":true}}}`
)

// ADR-067 §Portal 边界与发票分类: every session names the configured,
// update-disabled Portal configuration, so the Portal cannot change a plan.
func TestPortalOpensTheSessionUnderTheConfiguredUpdateDisabledConfiguration(t *testing.T) {
	userID := "u-" + t.Name()
	seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, "active", 1700000000)

	fake := &portalFake{configJSON: safePortalConfiguration}
	stripe := testStripe()
	stripe.PortalConfigurationID = "bpc_safe"
	h := NewHandler(fake.client(t), "https://example.com", stripe, nil)
	w := doRequest(t, http.MethodPost, "/billing/portal", h.Portal, userID, ``)

	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(`"url":"https://billing.stripe.test/p/session/bps_1"`)) {
		t.Fatalf("status = %d body = %s, want 200 with the session url", w.Code, w.Body.String())
	}
	if len(fake.configReads) != 1 || fake.configReads[0] != "bpc_safe" {
		t.Errorf("configuration reads = %v, want [bpc_safe]", fake.configReads)
	}
	if len(fake.sessions) != 1 {
		t.Fatalf("sessions created = %d, want 1", len(fake.sessions))
	}
	if len(fake.defaultReads) != 0 {
		t.Fatalf("explicit override queried Stripe defaults: %v", fake.defaultReads)
	}
	form := fake.sessions[0]
	if got := form.Get("configuration"); got != "bpc_safe" {
		t.Errorf("configuration = %q, want bpc_safe", got)
	}
	if got := form.Get("customer"); got != "cus_"+userID {
		t.Errorf("customer = %q, want cus_%s", got, userID)
	}
	if got := form.Get("return_url"); got != "https://example.com/billing" {
		t.Errorf("return_url = %q, want https://example.com/billing", got)
	}
}

// Stripe's default configuration is usable when it satisfies the same policy.
// Bind the session to the checked ID rather than leaving Stripe to choose again.
func TestPortalUsesTheCheckedDefaultWithoutAnExplicitConfigurationID(t *testing.T) {
	userID := "u-" + t.Name()
	seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, "active", 1700000000)
	defaultConfig := strings.Replace(safePortalConfiguration, `"active":true`, `"active":true,"is_default":true`, 1)
	fake := &portalFake{defaultJSON: `{"object":"list","has_more":false,"data":[` + defaultConfig + `]}`}
	cfg := testStripe()
	cfg.PortalConfigurationID = ""
	h := NewHandler(fake.client(t), "https://example.com", cfg, nil)
	w := doRequest(t, http.MethodPost, "/billing/portal", h.Portal, userID, ``)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", w.Code, w.Body.String())
	}
	if len(fake.defaultReads) != 1 || fake.defaultReads[0].Get("is_default") != "true" || fake.defaultReads[0].Get("active") != "true" {
		t.Fatalf("default configuration queries = %v, want one active/default query", fake.defaultReads)
	}
	if len(fake.sessions) != 1 || fake.sessions[0].Get("configuration") != "bpc_safe" {
		t.Fatalf("sessions = %v, want one session pinned to bpc_safe", fake.sessions)
	}
}

// Both explicit and default configurations must be verified. Failed explicit
// overrides never fall back to a potentially different default configuration.
func TestPortalRefusesWithoutASafeConfiguration(t *testing.T) {
	cases := []struct {
		name            string
		configurationID string
		fake            portalFake
		wantReads       int
	}{
		{name: "no active default", configurationID: "", wantReads: 0},
		{name: "default lookup fails", configurationID: "", fake: portalFake{configStatus: http.StatusForbidden}, wantReads: 0},
		{name: "unsafe default", configurationID: "", fake: portalFake{defaultJSON: `{"object":"list","has_more":false,"data":[{"id":"bpc_default","active":true,"is_default":true,"features":{"subscription_update":{"enabled":true}}}]}`}, wantReads: 0},
		{name: "subscription updates enabled", configurationID: "bpc_updates", fake: portalFake{configJSON: updatesPortalConfiguration}, wantReads: 1},
		{name: "Stripe can't read it", configurationID: "bpc_safe", fake: portalFake{configStatus: http.StatusInternalServerError}, wantReads: 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			userID := "u-" + t.Name()
			seedSubscription(t, userID, "cus_"+userID, "sub_"+userID, "active", 1700000000)

			fake := tc.fake
			stripe := testStripe()
			stripe.PortalConfigurationID = tc.configurationID
			h := NewHandler(fake.client(t), "https://example.com", stripe, nil)
			w := doRequest(t, http.MethodPost, "/billing/portal", h.Portal, userID, ``)

			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d body = %s, want 503", w.Code, w.Body.String())
			}
			if !bytes.Contains(w.Body.Bytes(), []byte(`"message":"The billing portal is unavailable right now. Please try again later."`)) {
				t.Errorf("body = %s, want the retryable portal message", w.Body.String())
			}
			if len(fake.configReads) != tc.wantReads {
				t.Errorf("configuration reads = %d, want %d", len(fake.configReads), tc.wantReads)
			}
			if tc.configurationID != "" && len(fake.defaultReads) != 0 {
				t.Errorf("explicit override failure fell back to default: %v", fake.defaultReads)
			}
			if len(fake.sessions) != 0 {
				t.Errorf("sessions created = %d, want none", len(fake.sessions))
			}
		})
	}
}

// ADR-067: the Subscription carries its ENX owner (subscription metadata)
// as well as the Checkout Session's client_reference_id.
func TestSubscriptionCheckoutAttributesTheSubscriptionToTheUser(t *testing.T) {
	userID := "u-" + t.Name()
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
