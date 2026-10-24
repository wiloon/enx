package stripe

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

// planChangeJSON is the safe plan-change configuration, made inactive or
// switched off on request.
func planChangeJSON(active, subscriptionUpdate bool) string {
	raw := strings.Replace(safePlanChangeJSON, `"id": "bpc_change"`, `"id": "bpc_1"`, 1)
	if !active {
		raw = strings.Replace(raw, `"active": true`, `"active": false`, 1)
	}
	if !subscriptionUpdate {
		raw = strings.Replace(raw, `"enabled": true,
      "default_allowed_updates"`, `"enabled": false,
      "default_allowed_updates"`, 1)
	}
	return raw
}

func TestResolvePlanChangePortalConfiguration(t *testing.T) {
	t.Run("no active default configuration is missing", func(t *testing.T) {
		sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"object":"list","has_more":false,"data":[]}`))
		})
		if _, err := ResolvePlanChangePortalConfiguration(context.Background(), sc, "", testTierPrices); !errors.Is(err, ErrPortalConfigurationMissing) {
			t.Fatalf("got %v, want ErrPortalConfigurationMissing", err)
		}
	})

	for _, tc := range []struct {
		name           string
		active, update bool
		wantUnsafe     bool
	}{
		{name: "the safe override is used", active: true, update: true},
		{name: "an override with plan switching off is unsafe", active: true, update: false, wantUnsafe: true},
		{name: "an inactive override is unsafe", active: false, update: true, wantUnsafe: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var paths []string
			sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				paths = append(paths, r.Method+" "+r.URL.Path)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(planChangeJSON(tc.active, tc.update)))
			})
			id, err := ResolvePlanChangePortalConfiguration(context.Background(), sc, "bpc_1", testTierPrices)
			if len(paths) != 1 || paths[0] != "GET /v1/billing_portal/configurations/bpc_1" {
				t.Errorf("Stripe calls = %q, want only GET /v1/billing_portal/configurations/bpc_1", paths)
			}
			if tc.wantUnsafe != errors.Is(err, ErrPortalConfigurationUnsafe) || (!tc.wantUnsafe && (err != nil || id != "bpc_1")) {
				t.Fatalf("got %q, %v; want unsafe=%v", id, err, tc.wantUnsafe)
			}
		})
	}

	t.Run("an override Stripe can't read is an error and never falls back", func(t *testing.T) {
		var paths []string
		sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			paths = append(paths, r.URL.Path)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such configuration"}}`))
		})
		_, err := ResolvePlanChangePortalConfiguration(context.Background(), sc, "bpc_other_account", testTierPrices)
		if err == nil || errors.Is(err, ErrPortalConfigurationUnsafe) || errors.Is(err, ErrPortalConfigurationMissing) {
			t.Fatalf("got %v, want the Stripe error", err)
		}
		if len(paths) != 1 {
			t.Fatalf("Stripe calls = %q, want only the override read", paths)
		}
	})
}

func TestDefaultPlanChangePortalConfigurationMustBeUniqueAndSafe(t *testing.T) {
	defaultConfig := func(active, update bool) string { return planChangeJSON(active, update) }
	nonDefault := strings.Replace(planChangeJSON(true, true), `"is_default": true`, `"is_default": false`, 1)
	for _, tc := range []struct {
		name, data string
		hasMore    bool
		wantError  error
	}{
		{name: "safe default", data: defaultConfig(true, true)},
		{name: "no default", data: "", wantError: ErrPortalConfigurationMissing},
		{name: "switching off", data: defaultConfig(true, false), wantError: ErrPortalConfigurationUnsafe},
		{name: "inactive", data: defaultConfig(false, true), wantError: ErrPortalConfigurationUnsafe},
		{name: "non-default response", data: nonDefault, wantError: ErrPortalConfigurationUnsafe},
		{name: "ambiguous defaults", data: defaultConfig(true, true) + "," + defaultConfig(true, true), wantError: ErrPortalConfigurationUnsafe},
		{name: "more unverified results", data: defaultConfig(true, true), hasMore: true, wantError: ErrPortalConfigurationUnsafe},
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
			id, err := ResolvePlanChangePortalConfiguration(context.Background(), sc, "", testTierPrices)
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
	id, err := ResolvePlanChangePortalConfiguration(context.Background(), sc, "", testTierPrices)
	if err == nil || id != "" || calls != 1 {
		t.Fatalf("got %q, %v after %d calls; want no configuration and the lookup error", id, err, calls)
	}
}

func TestResolveRestrictedPortalConfiguration(t *testing.T) {
	untagged := strings.Replace(safeRestrictedJSON, `"metadata": {"enx_portal": "restricted"}`, `"metadata": {}`, 1)
	switchingOn := strings.Replace(safeRestrictedJSON, `"subscription_update": {"enabled": false}`, `"subscription_update": {"enabled": true}`, 1)

	for _, tc := range []struct {
		name      string
		pages     []string
		wantID    string
		wantError error
	}{
		{name: "the one tagged configuration", pages: []string{untagged + "," + safeRestrictedJSON}, wantID: "bpc_restricted"},
		{name: "found on a later page", pages: []string{untagged, safeRestrictedJSON}, wantID: "bpc_restricted"},
		{name: "none tagged", pages: []string{untagged}, wantError: ErrPortalConfigurationMissing},
		{name: "two tagged", pages: []string{safeRestrictedJSON + "," + strings.Replace(safeRestrictedJSON, "bpc_restricted", "bpc_restricted_2", 1)}, wantError: ErrPortalConfigurationUnsafe},
		{name: "the tagged one has switching on", pages: []string{switchingOn}, wantError: ErrPortalConfigurationUnsafe},
	} {
		t.Run(tc.name, func(t *testing.T) {
			page := 0
			sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/v1/billing_portal/configurations" || r.URL.Query().Get("active") != "true" || r.URL.Query().Has("is_default") {
					t.Errorf("unexpected restricted query: %s %s", r.Method, r.URL.String())
				}
				more := "false"
				if page < len(tc.pages)-1 {
					more = "true"
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"object":"list","has_more":` + more + `,"data":[` + tc.pages[page] + `]}`))
				page++
			})
			id, err := ResolveRestrictedPortalConfiguration(context.Background(), sc, "")
			if tc.wantError != nil {
				if !errors.Is(err, tc.wantError) || id != "" {
					t.Fatalf("got %q, %v; want empty id and %v", id, err, tc.wantError)
				}
			} else if err != nil || id != tc.wantID {
				t.Fatalf("got %q, %v; want %s", id, err, tc.wantID)
			}
		})
	}

	t.Run("the override is read alone and never falls back", func(t *testing.T) {
		var paths []string
		sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			paths = append(paths, r.Method+" "+r.URL.Path)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":{"type":"api_error","message":"boom"}}`))
		})
		id, err := ResolveRestrictedPortalConfiguration(context.Background(), sc, "bpc_override")
		if err == nil || id != "" {
			t.Fatalf("got %q, %v; want the Stripe error", id, err)
		}
		if len(paths) != 1 || paths[0] != "GET /v1/billing_portal/configurations/bpc_override" {
			t.Fatalf("Stripe calls = %q, want only the override read", paths)
		}
	})

	t.Run("a safe override is used even without the tag", func(t *testing.T) {
		sc := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(untagged))
		})
		if id, err := ResolveRestrictedPortalConfiguration(context.Background(), sc, "bpc_restricted"); err != nil || id != "bpc_restricted" {
			t.Fatalf("got %q, %v; want bpc_restricted", id, err)
		}
	})
}
