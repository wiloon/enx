package stripe

import (
	"context"
	"net/http"
	"net/url"
	"reflect"
	"testing"

	"enx-api/billing/eligibility"
	"enx-api/billing/portalsession"
)

var _ portalsession.Stripe = (*PortalClient)(nil)

func TestThePortalClientReadsASubscriptionsLiveStateAndItems(t *testing.T) {
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/subscriptions/sub_1" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"sub_1","object":"subscription","status":"active",
			"cancel_at_period_end":false,"cancel_at":1795507901,
			"pending_update":{"expires_at":1795000000},
			"schedule":"sub_sched_1",
			"items":{"object":"list","has_more":false,"data":[
				{"id":"si_1","object":"subscription_item","current_period_end":1795507901,"price":{"id":"price_pro","object":"price"}}
			]}}`))
	})

	got, err := NewPortalClient(sc, "", "", nil).Subscription(context.Background(), "sub_1")

	if err != nil {
		t.Fatalf("Subscription: %v", err)
	}
	want := portalsession.Subscription{
		Live: eligibility.Live{
			Status: "active", CancelAt: 1795507901, CurrentPeriodEnd: 1795507901,
			PendingUpdate: true, HasSchedule: true,
		},
		Items:         []portalsession.Item{{ID: "si_1", PriceID: "price_pro"}},
		ItemsComplete: true,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Subscription = %+v, want %+v", got, want)
	}
}

func TestThePortalClientReturnsAMissingSubscriptionAsAnError(t *testing.T) {
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such subscription: 'sub_1'"}}`))
	})

	got, err := NewPortalClient(sc, "", "", nil).Subscription(context.Background(), "sub_1")

	if err == nil {
		t.Errorf("Subscription of a missing subscription = %+v with no error, want an error", got)
	}
}

// portalSessionForm records the form of the one Portal session created.
func portalSessionForm(t *testing.T, form *url.Values) *PortalClient {
	t.Helper()
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/billing_portal/sessions" {
			http.NotFound(w, r)
			return
		}
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		*form = r.PostForm
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"bps_1","object":"billing_portal.session","url":"https://billing.stripe.com/p/session/bps_1"}`))
	})
	return NewPortalClient(sc, "", "", nil)
}

func TestThePortalClientCreatesAPlanChangeDeepLink(t *testing.T) {
	var form url.Values
	client := portalSessionForm(t, &form)

	got, err := client.CreateSession(context.Background(), portalsession.Session{
		CustomerID:      "cus_1",
		ConfigurationID: "bpc_change",
		ReturnURL:       "https://enx.example/billing",
		PlanChange:      &portalsession.PlanChange{SubscriptionID: "sub_1", ItemID: "si_1", PriceID: "price_max"},
	})

	if err != nil || got != "https://billing.stripe.com/p/session/bps_1" {
		t.Fatalf("CreateSession = %q, %v; want the session URL", got, err)
	}
	want := url.Values{
		"customer":        {"cus_1"},
		"configuration":   {"bpc_change"},
		"return_url":      {"https://enx.example/billing"},
		"flow_data[type]": {"subscription_update_confirm"},
		"flow_data[subscription_update_confirm][subscription]":       {"sub_1"},
		"flow_data[subscription_update_confirm][items][0][id]":       {"si_1"},
		"flow_data[subscription_update_confirm][items][0][price]":    {"price_max"},
		"flow_data[subscription_update_confirm][items][0][quantity]": {"1"},
		"flow_data[after_completion][type]":                          {"redirect"},
		"flow_data[after_completion][redirect][return_url]":          {"https://enx.example/billing"},
	}
	if !reflect.DeepEqual(form, want) {
		t.Errorf("session form = %v\nwant %v", form, want)
	}
}

func TestThePortalClientCreatesAPortalHomeSession(t *testing.T) {
	var form url.Values
	client := portalSessionForm(t, &form)

	_, err := client.CreateSession(context.Background(), portalsession.Session{
		CustomerID: "cus_1", ConfigurationID: "bpc_restricted", ReturnURL: "https://enx.example/billing",
	})

	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	want := url.Values{
		"customer":      {"cus_1"},
		"configuration": {"bpc_restricted"},
		"return_url":    {"https://enx.example/billing"},
	}
	if !reflect.DeepEqual(form, want) {
		t.Errorf("session form = %v, want %v", form, want)
	}
}
