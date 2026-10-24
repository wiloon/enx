package billing

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"enx-api/billing/acceptance"
	"enx-api/billing/eligibility"
	"enx-api/billing/portalsession"

	"github.com/gin-gonic/gin"
)

const (
	sessionReturnURL  = "https://enx.example/billing"
	sessionURL        = "https://billing.stripe.com/p/session/test"
	sessionChangeConf = "bpc_change"
	sessionRestrConf  = "bpc_restricted"
)

var sessionTierPrices = map[string]string{"pro": "price_pro", "pro-plus": "price_pro_plus", "max": "price_max"}

type sessionStore struct {
	owner portalsession.Owner
	err   error
}

func (s *sessionStore) Owner(context.Context, string) (portalsession.Owner, error) {
	return s.owner, s.err
}

// sessionStripe holds live subscriptions and records the sessions created.
type sessionStripe struct {
	subs     map[string]portalsession.Subscription
	err      error
	sessions []portalsession.Session
}

func (f *sessionStripe) Subscription(_ context.Context, id string) (portalsession.Subscription, error) {
	if f.err != nil {
		return portalsession.Subscription{}, f.err
	}
	sub, ok := f.subs[id]
	if !ok {
		return portalsession.Subscription{}, errors.New("no such subscription: " + id)
	}
	return sub, nil
}

func (f *sessionStripe) TierPrices(context.Context) (map[string]string, error) {
	return sessionTierPrices, f.err
}

func (f *sessionStripe) PlanChangeConfiguration(context.Context, map[string]string) (string, error) {
	return sessionChangeConf, f.err
}

func (f *sessionStripe) RestrictedConfiguration(context.Context) (string, error) {
	return sessionRestrConf, f.err
}

func (f *sessionStripe) CreateSession(_ context.Context, s portalsession.Session) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	f.sessions = append(f.sessions, s)
	return sessionURL, nil
}

// proSubscriber accepts sub_a, on Pro, on Customer cus_a.
func proSubscriber(owned ...eligibility.Owned) portalsession.Owner {
	return portalsession.Owner{
		Owned:              append([]eligibility.Owned{{ID: "sub_a", StoredStatus: "active"}}, owned...),
		AcceptedID:         "sub_a",
		AcceptedCustomerID: "cus_a",
		CustomerID:         "cus_normal",
	}
}

func liveOn(priceID string, live eligibility.Live) map[string]portalsession.Subscription {
	return map[string]portalsession.Subscription{
		"sub_a": {Live: live, Items: []portalsession.Item{{ID: "si_a", PriceID: priceID}}, ItemsComplete: true},
	}
}

var activePro = liveOn("price_pro", eligibility.Live{Status: "active", CurrentPeriodEnd: 1795507901})

type sessionResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Reason  string `json:"reason"`
	URL     string `json:"url"`
}

func serveSession(t *testing.T, store *sessionStore, stripe *sessionStripe, path, body string) (int, sessionResponse) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	h := NewPortalSessionHandler(portalsession.New(store, stripe, sessionReturnURL))
	router := gin.New()
	router.POST("/api/billing/portal", setUserID("user_1"), h.Home)
	router.POST("/api/billing/portal/plan-change", setUserID("user_1"), h.PlanChange)
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	var resp sessionResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	return w.Code, resp
}

func TestThePortalHomeAnswersTheSessionURL(t *testing.T) {
	stripe := &sessionStripe{subs: activePro}

	code, resp := serveSession(t, &sessionStore{owner: proSubscriber()}, stripe, "/api/billing/portal", "")

	if code != http.StatusOK || !resp.Success || resp.URL != sessionURL {
		t.Fatalf("status = %d, %+v; want 200 with the session URL", code, resp)
	}
	want := []portalsession.Session{{CustomerID: "cus_a", ConfigurationID: sessionChangeConf, ReturnURL: sessionReturnURL}}
	if !reflect.DeepEqual(stripe.sessions, want) {
		t.Errorf("sessions = %+v, want %+v", stripe.sessions, want)
	}
}

func TestABlockedUsersPortalHomeIsStillAnsweredUnderTheRestrictedConfiguration(t *testing.T) {
	owner := proSubscriber(eligibility.Owned{ID: "sub_b", Conflict: eligibility.ConflictOpen, StoredStatus: "canceled"})
	stripe := &sessionStripe{subs: activePro}

	code, resp := serveSession(t, &sessionStore{owner: owner}, stripe, "/api/billing/portal", "")

	if code != http.StatusOK || resp.URL != sessionURL {
		t.Fatalf("status = %d, %+v; want 200 with the session URL", code, resp)
	}
	if len(stripe.sessions) != 1 || stripe.sessions[0].ConfigurationID != sessionRestrConf {
		t.Errorf("sessions = %+v, want one under the restricted configuration", stripe.sessions)
	}
}

func TestAPortalHomeForAUserWithNoStripeCustomerIsAnswered404(t *testing.T) {
	stripe := &sessionStripe{}

	code, resp := serveSession(t, &sessionStore{}, stripe, "/api/billing/portal", "")

	if code != http.StatusNotFound || resp.Success || resp.Message != "no billing account yet" {
		t.Errorf("status = %d, %+v; want 404 no billing account yet", code, resp)
	}
	if len(stripe.sessions) != 0 {
		t.Errorf("sessions = %+v, want none", stripe.sessions)
	}
}

func TestAPlanChangeAnswersTheSubscriptionUpdateConfirmDeepLink(t *testing.T) {
	stripe := &sessionStripe{subs: activePro}

	code, resp := serveSession(t, &sessionStore{owner: proSubscriber()}, stripe, "/api/billing/portal/plan-change", `{"tier":"max"}`)

	if code != http.StatusOK || !resp.Success || resp.URL != sessionURL {
		t.Fatalf("status = %d, %+v; want 200 with the session URL", code, resp)
	}
	want := []portalsession.Session{{
		CustomerID:      "cus_a",
		ConfigurationID: sessionChangeConf,
		ReturnURL:       sessionReturnURL,
		PlanChange:      &portalsession.PlanChange{SubscriptionID: "sub_a", ItemID: "si_a", PriceID: "price_max"},
	}}
	if !reflect.DeepEqual(stripe.sessions, want) {
		t.Errorf("sessions = %+v, want %+v", stripe.sessions, want)
	}
}

func TestAPlanChangeWhileStripeHoldsAChangeAnswersThePortalHome(t *testing.T) {
	stripe := &sessionStripe{subs: liveOn("price_pro", eligibility.Live{Status: "active", PendingUpdate: true})}

	code, resp := serveSession(t, &sessionStore{owner: proSubscriber()}, stripe, "/api/billing/portal/plan-change", `{"tier":"max"}`)

	if code != http.StatusOK || resp.URL != sessionURL {
		t.Fatalf("status = %d, %+v; want 200 with the session URL", code, resp)
	}
	if len(stripe.sessions) != 1 || stripe.sessions[0].PlanChange != nil {
		t.Errorf("sessions = %+v, want one Portal home session", stripe.sessions)
	}
}

func TestARefusedPlanChangeCreatesNoSession(t *testing.T) {
	deleting := proSubscriber()
	deleting.Deletion = acceptance.DeletionInProgress
	conflicted := proSubscriber(eligibility.Owned{ID: "sub_b", Conflict: eligibility.ConflictOpen, StoredStatus: "canceled"})

	cases := []struct {
		name       string
		owner      portalsession.Owner
		subs       map[string]portalsession.Subscription
		body       string
		wantCode   int
		wantReason string
		wantMsg    string
	}{
		{"an open subscription conflict", conflicted, activePro, `{"tier":"max"}`,
			http.StatusConflict, "subscription_conflict",
			"Your subscription needs an administrator's attention before you can change plans. Contact billing support."},
		{"an account deletion in progress", deleting, activePro, `{"tier":"max"}`,
			http.StatusConflict, "deletion_in_progress",
			"Your account is being deleted, so your plan can't be changed."},
		{"the current tier", proSubscriber(), activePro, `{"tier":"pro"}`,
			http.StatusConflict, "not_a_plan_change",
			"There is no plan change to make: you are already on this plan, or you have no active subscription to change."},
		{"no accepted subscription", portalsession.Owner{CustomerID: "cus_normal"}, nil, `{"tier":"max"}`,
			http.StatusConflict, "not_a_plan_change",
			"There is no plan change to make: you are already on this plan, or you have no active subscription to change."},
		{"a subscription on a Price outside ENX's tiers", proSubscriber(), liveOn("price_dashboard_mistake", eligibility.Live{Status: "active"}), `{"tier":"max"}`,
			http.StatusConflict, "subscription_needs_attention",
			"Your subscription can't be changed online right now. Contact billing support."},
		{"a tier ENX does not offer", proSubscriber(), activePro, `{"tier":"ultra"}`,
			http.StatusBadRequest, "", `tier must be "pro", "pro-plus", or "max"`},
		{"a body without a tier", proSubscriber(), activePro, `{}`,
			http.StatusBadRequest, "", `tier must be "pro", "pro-plus", or "max"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stripe := &sessionStripe{subs: tc.subs}

			code, resp := serveSession(t, &sessionStore{owner: tc.owner}, stripe, "/api/billing/portal/plan-change", tc.body)

			if code != tc.wantCode || resp.Success || resp.Reason != tc.wantReason || resp.Message != tc.wantMsg {
				t.Errorf("status = %d, %+v; want %d reason %q %q", code, resp, tc.wantCode, tc.wantReason, tc.wantMsg)
			}
			if len(stripe.sessions) != 0 {
				t.Errorf("sessions = %+v, want none", stripe.sessions)
			}
		})
	}
}

func TestPortalSessionsThatCannotBeCreatedAreAnswered503(t *testing.T) {
	boom := errors.New("stripe is down")
	cases := []struct {
		name   string
		store  *sessionStore
		stripe *sessionStripe
		path   string
		body   string
	}{
		{"the Portal home, store failure", &sessionStore{err: boom}, &sessionStripe{subs: activePro}, "/api/billing/portal", ""},
		{"the Portal home, Stripe failure", &sessionStore{owner: proSubscriber()}, &sessionStripe{err: boom}, "/api/billing/portal", ""},
		{"a plan change, store failure", &sessionStore{err: boom}, &sessionStripe{subs: activePro}, "/api/billing/portal/plan-change", `{"tier":"max"}`},
		{"a plan change, Stripe failure", &sessionStore{owner: proSubscriber()}, &sessionStripe{err: boom}, "/api/billing/portal/plan-change", `{"tier":"max"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, resp := serveSession(t, tc.store, tc.stripe, tc.path, tc.body)

			if code != http.StatusServiceUnavailable || resp.Success || resp.Message != "The billing portal is unavailable right now. Please try again later." {
				t.Errorf("status = %d, %+v; want 503 with retry copy", code, resp)
			}
			if len(tc.stripe.sessions) != 0 {
				t.Errorf("sessions = %+v, want none", tc.stripe.sessions)
			}
		})
	}
}
