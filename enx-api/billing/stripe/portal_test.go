package stripe

import (
	"context"
	"errors"
	"net/http"
	"strings"
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

func TestResolvePortalConfiguration(t *testing.T) {
	t.Run("no active default configuration is missing", func(t *testing.T) {
		sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"object":"list","has_more":false,"data":[]}`))
		})
		if _, err := ResolvePortalConfiguration(context.Background(), sc, ""); !errors.Is(err, ErrPortalConfigurationMissing) {
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
			_, err := ResolvePortalConfiguration(context.Background(), sc, "bpc_1")
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
		_, err := ResolvePortalConfiguration(context.Background(), sc, "bpc_other_account")
		if err == nil || errors.Is(err, ErrPortalConfigurationUnsafe) || errors.Is(err, ErrPortalConfigurationMissing) {
			t.Fatalf("got %v, want the Stripe error", err)
		}
	})
}

func TestDefaultPortalConfigurationMustBeUniqueAndSafe(t *testing.T) {
	defaultConfig := func(active, update bool) string {
		return strings.Replace(portalConfigurationJSON(active, update), `"active":`, `"is_default":true,"active":`, 1)
	}
	for _, tc := range []struct {
		name, data string
		hasMore    bool
		wantError  error
	}{
		{name: "safe default", data: defaultConfig(true, false)},
		{name: "no default", data: "", wantError: ErrPortalConfigurationMissing},
		{name: "updates enabled", data: defaultConfig(true, true), wantError: ErrPortalConfigurationUnsafe},
		{name: "inactive", data: defaultConfig(false, false), wantError: ErrPortalConfigurationUnsafe},
		{name: "non-default response", data: portalConfigurationJSON(true, false), wantError: ErrPortalConfigurationUnsafe},
		{name: "ambiguous defaults", data: defaultConfig(true, false) + "," + defaultConfig(true, false), wantError: ErrPortalConfigurationUnsafe},
		{name: "more unverified results", data: defaultConfig(true, false), hasMore: true, wantError: ErrPortalConfigurationUnsafe},
		{name: "missing features", data: `{"id":"bpc_1","active":true,"is_default":true}`, wantError: ErrPortalConfigurationUnsafe},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != http.MethodGet || r.URL.Path != "/v1/billing_portal/configurations" || r.URL.Query().Get("active") != "true" || r.URL.Query().Get("is_default") != "true" {
					t.Errorf("unexpected default query: %s %s", r.Method, r.URL.String())
				}
				more := "false"
				if tc.hasMore {
					more = "true"
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"object":"list","has_more":` + more + `,"data":[` + tc.data + `]}`))
			})
			id, err := ResolvePortalConfiguration(context.Background(), sc, "")
			if calls != 1 {
				t.Errorf("Stripe calls = %d, want 1", calls)
			}
			if tc.wantError != nil {
				if !errors.Is(err, tc.wantError) || id != "" {
					t.Fatalf("got %q, %v; want empty id and %v", id, err, tc.wantError)
				}
			} else if err != nil || id != "bpc_1" {
				t.Fatalf("got %q, %v; want bpc_1", id, err)
			}
		})
	}
}

func TestDefaultPortalConfigurationReadFailureDoesNotSelectAnUncheckedConfiguration(t *testing.T) {
	calls := 0
	sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1/billing_portal/configurations" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"Not allowed"}}`))
	})
	id, err := ResolvePortalConfiguration(context.Background(), sc, "")
	if err == nil || id != "" || calls != 1 {
		t.Fatalf("got %q, %v after %d calls; want no configuration and the lookup error", id, err, calls)
	}
}
