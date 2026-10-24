package stripe

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func portalConfigurationJSON(active, subscriptionUpdate bool) string {
	b := func(v bool) string {
		if v {
			return "true"
		}
		return "false"
	}
	return `{"id":"bpc_1","object":"billing_portal.configuration","active":` + b(active) +
		`,"features":{"subscription_cancel":{"enabled":true},"payment_method_update":{"enabled":true},"invoice_history":{"enabled":true},"subscription_update":{"enabled":` + b(subscriptionUpdate) + `}}}`
}

func TestCheckPortalConfiguration(t *testing.T) {
	t.Run("an empty id is missing and asks Stripe nothing", func(t *testing.T) {
		sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			t.Errorf("unexpected Stripe call: %s %s", r.Method, r.URL.Path)
		})
		if err := CheckPortalConfiguration(context.Background(), sc, ""); !errors.Is(err, ErrPortalConfigurationMissing) {
			t.Fatalf("got %v, want ErrPortalConfigurationMissing", err)
		}
	})

	for _, tc := range []struct {
		name           string
		active, update bool
		wantUnsafe     bool
	}{
		{name: "active with subscription updates off is safe", active: true, update: false},
		{name: "subscription updates on is unsafe", active: true, update: true, wantUnsafe: true},
		{name: "an inactive configuration is unsafe", active: false, update: false, wantUnsafe: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var path string
			sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				path = r.Method + " " + r.URL.Path
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(portalConfigurationJSON(tc.active, tc.update)))
			})
			err := CheckPortalConfiguration(context.Background(), sc, "bpc_1")
			if path != "GET /v1/billing_portal/configurations/bpc_1" {
				t.Errorf("Stripe call = %q, want GET /v1/billing_portal/configurations/bpc_1", path)
			}
			if tc.wantUnsafe != errors.Is(err, ErrPortalConfigurationUnsafe) || (!tc.wantUnsafe && err != nil) {
				t.Fatalf("got %v, want unsafe=%v", err, tc.wantUnsafe)
			}
		})
	}

	t.Run("a configuration Stripe can't read is an error, not safe", func(t *testing.T) {
		sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such configuration"}}`))
		})
		err := CheckPortalConfiguration(context.Background(), sc, "bpc_other_account")
		if err == nil || errors.Is(err, ErrPortalConfigurationUnsafe) || errors.Is(err, ErrPortalConfigurationMissing) {
			t.Fatalf("got %v, want the Stripe error", err)
		}
	})
}
