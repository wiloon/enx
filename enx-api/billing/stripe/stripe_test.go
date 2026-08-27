package stripe

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	stripeSDK "github.com/stripe/stripe-go/v86"
	"github.com/stripe/stripe-go/v86/webhook"
)

// newTestClient builds a Stripe client whose API backend points at a local
// httptest.Server, so package functions can be tested without hitting the
// real Stripe API. handler decides what each mock endpoint returns.
func newTestClient(t *testing.T, handler http.HandlerFunc) *stripeSDK.Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{
		URL:        stripeSDK.String(server.URL),
		HTTPClient: server.Client(),
	})
	return stripeSDK.NewClient("sk_test_123", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend}))
}

func priceListResponse(priceIDs ...string) string {
	var data []string
	for _, id := range priceIDs {
		data = append(data, `{"id":"`+id+`","object":"price"}`)
	}
	return `{"object":"list","url":"/v1/prices","has_more":false,"data":[` + strings.Join(data, ",") + `]}`
}

func TestNew(t *testing.T) {
	t.Run("empty key returns error", func(t *testing.T) {
		sc, err := New("")
		if err == nil {
			t.Fatal("expected an error for empty secret key")
		}
		if sc != nil {
			t.Error("expected a nil client on error")
		}
	})

	t.Run("non-empty key returns a client", func(t *testing.T) {
		sc, err := New("sk_test_123")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if sc == nil {
			t.Fatal("expected a non-nil client")
		}
	})
}

func TestPriceForLookupKey(t *testing.T) {
	t.Run("returns the matching price", func(t *testing.T) {
		sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/v1/prices" {
				t.Errorf("unexpected path: %s", r.URL.Path)
			}
			if got := r.URL.Query().Get("lookup_keys[0]"); got != "pro-monthly" {
				t.Errorf("expected lookup_keys[0]=pro-monthly, got %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(priceListResponse("price_123")))
		})

		price, err := PriceForLookupKey(context.Background(), sc, "pro-monthly")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if price.ID != "price_123" {
			t.Errorf("expected price_123, got %s", price.ID)
		}
	})

	t.Run("no matching price returns an error", func(t *testing.T) {
		sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(priceListResponse()))
		})

		_, err := PriceForLookupKey(context.Background(), sc, "missing-key")
		if err == nil {
			t.Fatal("expected an error when no price matches")
		}
	})

	t.Run("API error is propagated", func(t *testing.T) {
		sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":{"message":"boom","type":"api_error"}}`))
		})

		_, err := PriceForLookupKey(context.Background(), sc, "pro-monthly")
		if err == nil {
			t.Fatal("expected an error on API failure")
		}
	})
}

func TestCreateCheckoutSession(t *testing.T) {
	t.Run("prefers existing customer over customer email", func(t *testing.T) {
		var sawCustomer, sawCustomerEmail string
		sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			switch {
			case r.Method == http.MethodGet && r.URL.Path == "/v1/prices":
				w.Write([]byte(priceListResponse("price_123")))
			case r.Method == http.MethodPost && r.URL.Path == "/v1/checkout/sessions":
				if err := r.ParseForm(); err != nil {
					t.Fatalf("failed to parse form: %v", err)
				}
				sawCustomer = r.PostForm.Get("customer")
				sawCustomerEmail = r.PostForm.Get("customer_email")
				w.Write([]byte(`{"id":"cs_test_123","object":"checkout.session","url":"https://checkout.stripe.com/cs_test_123"}`))
			default:
				t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
			}
		})

		session, err := CreateCheckoutSession(context.Background(), sc, CheckoutSessionParams{
			PriceLookupKey:    "pro-monthly",
			Mode:              "subscription",
			ClientReferenceID: "user_1",
			CustomerEmail:     "user@example.com",
			Customer:          "cus_existing",
			SuccessURL:        "https://example.com/success",
			CancelURL:         "https://example.com/cancel",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if session.ID != "cs_test_123" {
			t.Errorf("expected session id cs_test_123, got %s", session.ID)
		}
		if sawCustomer != "cus_existing" {
			t.Errorf("expected customer=cus_existing, got %q", sawCustomer)
		}
		if sawCustomerEmail != "" {
			t.Errorf("expected customer_email to be empty when customer is set, got %q", sawCustomerEmail)
		}
	})

	t.Run("falls back to customer email when no customer id", func(t *testing.T) {
		var sawCustomerEmail string
		sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			switch {
			case r.Method == http.MethodGet && r.URL.Path == "/v1/prices":
				w.Write([]byte(priceListResponse("price_123")))
			case r.Method == http.MethodPost && r.URL.Path == "/v1/checkout/sessions":
				if err := r.ParseForm(); err != nil {
					t.Fatalf("failed to parse form: %v", err)
				}
				sawCustomerEmail = r.PostForm.Get("customer_email")
				w.Write([]byte(`{"id":"cs_test_456","object":"checkout.session"}`))
			default:
				t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
			}
		})

		_, err := CreateCheckoutSession(context.Background(), sc, CheckoutSessionParams{
			PriceLookupKey:    "pro-monthly",
			Mode:              "payment",
			ClientReferenceID: "user_1",
			CustomerEmail:     "user@example.com",
			SuccessURL:        "https://example.com/success",
			CancelURL:         "https://example.com/cancel",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if sawCustomerEmail != "user@example.com" {
			t.Errorf("expected customer_email=user@example.com, got %q", sawCustomerEmail)
		}
	})

	t.Run("propagates the price lookup error", func(t *testing.T) {
		sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(priceListResponse()))
		})

		_, err := CreateCheckoutSession(context.Background(), sc, CheckoutSessionParams{
			PriceLookupKey: "missing-key",
			Mode:           "subscription",
		})
		if err == nil {
			t.Fatal("expected an error when the price lookup fails")
		}
	})
}

func TestCreatePortalSession(t *testing.T) {
	var sawCustomer, sawReturnURL string
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/billing_portal/sessions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatalf("failed to parse form: %v", err)
		}
		sawCustomer = r.PostForm.Get("customer")
		sawReturnURL = r.PostForm.Get("return_url")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"bps_test_123","object":"billing_portal.session","url":"https://billing.stripe.com/bps_test_123"}`))
	})

	session, err := CreatePortalSession(context.Background(), sc, "cus_123", "https://example.com/account")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if session.ID != "bps_test_123" {
		t.Errorf("expected session id bps_test_123, got %s", session.ID)
	}
	if sawCustomer != "cus_123" {
		t.Errorf("expected customer=cus_123, got %q", sawCustomer)
	}
	if sawReturnURL != "https://example.com/account" {
		t.Errorf("expected return_url=https://example.com/account, got %q", sawReturnURL)
	}
}

func TestSubscriptionTierForPrice(t *testing.T) {
	tierLookupKeys := map[string]string{
		"pro":      "pro-monthly",
		"pro-plus": "pro-plus-monthly",
		"max":      "max-monthly",
	}
	priceIDByLookupKey := map[string]string{
		"pro-monthly":      "price_pro",
		"pro-plus-monthly": "price_pro_plus",
		"max-monthly":      "price_max",
	}

	newHandler := func() http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			lookupKey := r.URL.Query().Get("lookup_keys[0]")
			w.Header().Set("Content-Type", "application/json")
			if id, ok := priceIDByLookupKey[lookupKey]; ok {
				w.Write([]byte(priceListResponse(id)))
				return
			}
			w.Write([]byte(priceListResponse()))
		}
	}

	t.Run("matches the pro-plus tier", func(t *testing.T) {
		sc := newTestClient(t, newHandler())
		tier, err := SubscriptionTierForPrice(context.Background(), sc, "price_pro_plus", tierLookupKeys)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if tier != "pro-plus" {
			t.Errorf("expected tier pro-plus, got %q", tier)
		}
	})

	t.Run("no match returns empty tier", func(t *testing.T) {
		sc := newTestClient(t, newHandler())
		tier, err := SubscriptionTierForPrice(context.Background(), sc, "price_unknown", tierLookupKeys)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if tier != "" {
			t.Errorf("expected empty tier, got %q", tier)
		}
	})

	t.Run("skips tiers with no configured lookup key", func(t *testing.T) {
		sc := newTestClient(t, newHandler())
		tier, err := SubscriptionTierForPrice(context.Background(), sc, "price_max", map[string]string{
			"pro": "pro-monthly",
			"max": "max-monthly",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if tier != "max" {
			t.Errorf("expected tier max, got %q", tier)
		}
	})
}

func TestConstructEvent(t *testing.T) {
	const secret = "whsec_test_secret"
	payload := []byte(`{"id":"evt_123","object":"event","type":"checkout.session.completed","api_version":"` + stripeSDK.APIVersion + `"}`)

	t.Run("valid signature is accepted", func(t *testing.T) {
		signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{
			Payload:   payload,
			Secret:    secret,
			Timestamp: time.Now(),
		})

		event, err := ConstructEvent(signed.Payload, signed.Header, secret)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if event.ID != "evt_123" {
			t.Errorf("expected event id evt_123, got %s", event.ID)
		}
		if event.Type != "checkout.session.completed" {
			t.Errorf("expected type checkout.session.completed, got %s", event.Type)
		}
	})

	t.Run("wrong secret is rejected", func(t *testing.T) {
		signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{
			Payload:   payload,
			Secret:    secret,
			Timestamp: time.Now(),
		})

		_, err := ConstructEvent(signed.Payload, signed.Header, "whsec_wrong_secret")
		if err == nil {
			t.Fatal("expected an error for a signature computed with a different secret")
		}
	})

	t.Run("missing signature header is rejected", func(t *testing.T) {
		_, err := ConstructEvent(payload, "", secret)
		if err == nil {
			t.Fatal("expected an error for a missing Stripe-Signature header")
		}
	})

	t.Run("expired timestamp is rejected", func(t *testing.T) {
		signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{
			Payload:   payload,
			Secret:    secret,
			Timestamp: time.Now().Add(-1 * time.Hour),
		})

		_, err := ConstructEvent(signed.Payload, signed.Header, secret)
		if err == nil {
			t.Fatal("expected an error for a stale timestamp outside the default tolerance")
		}
	})
}

// sanity check that priceListResponse produces valid JSON the SDK can parse.
func TestPriceListResponseFixtureIsValidJSON(t *testing.T) {
	var v map[string]interface{}
	if err := json.Unmarshal([]byte(priceListResponse("price_1", "price_2")), &v); err != nil {
		t.Fatalf("fixture is not valid JSON: %v", err)
	}
}
