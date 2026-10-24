package billing

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"enx-api/billing/alert"
	"enx-api/billing/conflict"
	"enx-api/billing/conflictadmin"
	"enx-api/billing/webhookevent"

	"github.com/gin-gonic/gin"
)

var (
	conflictDiscovered = time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
	conflictNow        = time.Date(2026, 10, 24, 9, 0, 0, 0, time.UTC)
)

// conflictStore holds one open conflict, sub_b of user_1, with one event
// delivered twice, and counts the resolutions saved on it.
type conflictStore struct {
	row       conflictadmin.Record
	query     conflict.ListQuery
	saves     int
	err       error
	listCalls int
}

func newConflictStore() *conflictStore {
	return &conflictStore{row: conflictadmin.Record{Version: 3, Conflict: conflictadmin.Conflict{
		SubscriptionID:         "sub_b",
		AcceptedSubscriptionID: "sub_a",
		OwnerID:                "user_1",
		CustomerID:             "cus_1",
		StripeStatus:           "active",
		Reason:                 "second_live_subscription",
		DiscoveredAt:           conflictDiscovered,
		Resolution:             conflict.Resolution{Status: conflict.Open},
		Support:                conflict.Support{Message: "I was charged twice.", At: conflictDiscovered.Add(time.Hour)},
	}}}
}

func (s *conflictStore) ListConflicts(_ context.Context, q conflict.ListQuery) ([]conflictadmin.Conflict, error) {
	s.listCalls++
	s.query = q
	if s.err != nil {
		return nil, s.err
	}
	return []conflictadmin.Conflict{s.row.Conflict}, nil
}

func (s *conflictStore) Conflict(_ context.Context, id string) (conflictadmin.Record, error) {
	if s.err != nil {
		return conflictadmin.Record{}, s.err
	}
	if id != "sub_b" {
		return conflictadmin.Record{}, conflictadmin.ErrNotFound
	}
	return s.row, nil
}

func (s *conflictStore) Events(_ context.Context, _ string) ([]conflictadmin.Event, error) {
	return []conflictadmin.Event{{
		EventID:   "evt_1",
		Type:      "invoice.paid",
		Status:    webhookevent.NeedsAttention,
		Attempts:  2,
		LastError: "conflict_invoice",
		Deliveries: []conflictadmin.Delivery{
			{ID: "dlv_1", ReceivedAt: conflictDiscovered},
			{ID: "dlv_2", ReceivedAt: conflictDiscovered.Add(time.Minute)},
		},
	}}, nil
}

func (s *conflictStore) SaveResolution(_ context.Context, save conflictadmin.ResolutionSave) error {
	s.saves++
	s.row.Version++
	s.row.Conflict.Resolution = save.Resolution
	return nil
}

func serveConflictAdmin(t *testing.T, store *conflictStore, method, target, body string) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	h := NewConflictAdminHandler(conflictadmin.New(store, func() time.Time { return conflictNow }))
	path := alert.AdminSubscriptionConflictsPath
	router.GET(path, setUserID("admin_1"), h.List)
	router.GET(path+"/:id", setUserID("admin_1"), h.Detail)
	router.PATCH(path+"/:id", setUserID("admin_1"), h.Resolve)
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	return w.Code, resp
}

func asJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

const openConflictJSON = `{"acceptedSubscriptionId":"sub_a","customerId":"cus_1","discoveredAt":"2026-10-23T08:00:00Z",` +
	`"reason":"second_live_subscription","resolution":null,"status":"open","stripeStatus":"active","subscriptionId":"sub_b",` +
	`"supportRequest":{"message":"I was charged twice.","sentAt":"2026-10-23T09:00:00Z"},"userId":"user_1"}`

func TestTheConflictListAnswersTheRequestedPage(t *testing.T) {
	store := newConflictStore()

	code, resp := serveConflictAdmin(t, store, http.MethodGet, "/api/admin/subscription-conflicts?status=open&limit=500&offset=10", "")

	if code != http.StatusOK || resp["success"] != true {
		t.Fatalf("status = %d, %v; want 200", code, resp)
	}
	if want := (conflict.ListQuery{Status: conflict.Open, Limit: conflict.MaxListLimit, Offset: 10}); store.query != want {
		t.Errorf("query = %+v, want %+v", store.query, want)
	}
	if got := asJSON(t, resp["conflicts"]); got != "["+openConflictJSON+"]" {
		t.Errorf("conflicts = %s\nwant [%s]", got, openConflictJSON)
	}
}

func TestAConflictListRequestThatIsInvalidIsAnswered400(t *testing.T) {
	cases := []struct {
		name, query, want string
	}{
		{"an unknown status", "status=closed", "status must be open or resolved"},
		{"a limit that is no number", "limit=ten", "limit and offset must be whole numbers"},
		{"an offset that is no number", "offset=1.5", "limit and offset must be whole numbers"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newConflictStore()

			code, resp := serveConflictAdmin(t, store, http.MethodGet, "/api/admin/subscription-conflicts?"+tc.query, "")

			if code != http.StatusBadRequest || resp["success"] != false || resp["message"] != tc.want {
				t.Errorf("status = %d, %v; want 400 %q", code, resp, tc.want)
			}
			if store.listCalls != 0 {
				t.Errorf("list calls = %d, want none", store.listCalls)
			}
		})
	}
}

func TestTheConflictDetailCarriesItsEventsAndDeliveries(t *testing.T) {
	code, resp := serveConflictAdmin(t, newConflictStore(), http.MethodGet, "/api/admin/subscription-conflicts/sub_b", "")

	if code != http.StatusOK || resp["success"] != true {
		t.Fatalf("status = %d, %v; want 200", code, resp)
	}
	if got := asJSON(t, resp["conflict"]); got != openConflictJSON {
		t.Errorf("conflict = %s\nwant %s", got, openConflictJSON)
	}
	wantEvents := `[{"attempts":2,"deliveries":[{"id":"dlv_1","receivedAt":"2026-10-23T08:00:00Z"},{"id":"dlv_2","receivedAt":"2026-10-23T08:01:00Z"}],` +
		`"eventId":"evt_1","lastError":"conflict_invoice","status":"needs_attention","type":"invoice.paid"}]`
	if got := asJSON(t, resp["events"]); got != wantEvents {
		t.Errorf("events = %s\nwant %s", got, wantEvents)
	}
}

func TestAResolvedConflictShowsWhoResolvedItWhenAndTheirNotes(t *testing.T) {
	store := newConflictStore()
	store.row.Conflict.Resolution = conflict.Resolution{Status: conflict.Resolved, ResolverID: "admin_2", ResolvedAt: conflictNow, Notes: "Refunded."}

	_, resp := serveConflictAdmin(t, store, http.MethodGet, "/api/admin/subscription-conflicts/sub_b", "")

	cf, _ := resp["conflict"].(map[string]any)
	want := `{"notes":"Refunded.","resolvedAt":"2026-10-24T09:00:00Z","resolvedBy":"admin_2","status":"resolved"}`
	if cf["status"] != "resolved" || asJSON(t, cf["resolution"]) != want {
		t.Errorf("conflict = %v, want status resolved with resolution %s", cf, want)
	}
}

func TestTheDetailOfAnUnknownConflictIsAnswered404(t *testing.T) {
	code, resp := serveConflictAdmin(t, newConflictStore(), http.MethodGet, "/api/admin/subscription-conflicts/sub_x", "")

	if code != http.StatusNotFound || resp["message"] != "no subscription conflict with that ID" {
		t.Errorf("status = %d, %v; want 404", code, resp)
	}
}

func TestAResolutionIsRecordedWithTheSignedInAdministrator(t *testing.T) {
	store := newConflictStore()

	code, resp := serveConflictAdmin(t, store, http.MethodPatch, "/api/admin/subscription-conflicts/sub_b",
		`{"status":"resolved","notes":"Refunded sub_b in Stripe."}`)

	if code != http.StatusOK || resp["success"] != true {
		t.Fatalf("status = %d, %v; want 200", code, resp)
	}
	want := `{"notes":"Refunded sub_b in Stripe.","resolvedAt":"2026-10-24T09:00:00Z","resolvedBy":"admin_1","status":"resolved"}`
	if got := asJSON(t, resp["resolution"]); got != want {
		t.Errorf("resolution = %s, want %s", got, want)
	}
	if store.saves != 1 {
		t.Errorf("saves = %d, want 1", store.saves)
	}
}

func TestAnIdenticalRepeatedResolutionIsAnswered200WithoutSaving(t *testing.T) {
	store := newConflictStore()
	body := `{"status":"resolved","notes":"Refunded."}`
	serveConflictAdmin(t, store, http.MethodPatch, "/api/admin/subscription-conflicts/sub_b", body)

	code, resp := serveConflictAdmin(t, store, http.MethodPatch, "/api/admin/subscription-conflicts/sub_b", body)

	if code != http.StatusOK || resp["success"] != true {
		t.Errorf("status = %d, %v; want 200", code, resp)
	}
	if store.saves != 1 {
		t.Errorf("saves = %d, want only the first", store.saves)
	}
}

func TestAResolutionThatIsRefusedSavesNothing(t *testing.T) {
	cases := []struct {
		name     string
		id       string
		body     string
		resolved bool
		wantCode int
		wantMsg  string
	}{
		{"different notes on a resolved conflict", "sub_b", `{"status":"resolved","notes":"Cancelled."}`, true,
			http.StatusConflict, "the conflict is already resolved with different notes"},
		{"a status other than resolved", "sub_b", `{"status":"open","notes":"Reopen."}`, false,
			http.StatusBadRequest, "status must be resolved"},
		{"blank notes", "sub_b", `{"status":"resolved","notes":"  "}`, false,
			http.StatusBadRequest, "notes are required"},
		{"a body that is not JSON", "sub_b", `status=resolved`, false,
			http.StatusBadRequest, "status and notes are required"},
		{"an unknown conflict", "sub_x", `{"status":"resolved","notes":"Refunded."}`, false,
			http.StatusNotFound, "no subscription conflict with that ID"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newConflictStore()
			if tc.resolved {
				store.row.Conflict.Resolution = conflict.Resolution{Status: conflict.Resolved, ResolverID: "admin_2", ResolvedAt: conflictDiscovered, Notes: "Refunded."}
			}

			code, resp := serveConflictAdmin(t, store, http.MethodPatch, "/api/admin/subscription-conflicts/"+tc.id, tc.body)

			if code != tc.wantCode || resp["success"] != false || resp["message"] != tc.wantMsg {
				t.Errorf("status = %d, %v; want %d %q", code, resp, tc.wantCode, tc.wantMsg)
			}
			if store.saves != 0 {
				t.Errorf("saves = %d, want none", store.saves)
			}
		})
	}
}

func TestConflictRequestsTheStoreCannotServeAreAnswered503(t *testing.T) {
	cases := []struct {
		name, method, target, body string
	}{
		{"list", http.MethodGet, "/api/admin/subscription-conflicts", ""},
		{"detail", http.MethodGet, "/api/admin/subscription-conflicts/sub_b", ""},
		{"resolution", http.MethodPatch, "/api/admin/subscription-conflicts/sub_b", `{"status":"resolved","notes":"Refunded."}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newConflictStore()
			store.err = errors.New("database is locked")

			code, resp := serveConflictAdmin(t, store, tc.method, tc.target, tc.body)

			if code != http.StatusServiceUnavailable || resp["success"] != false ||
				resp["message"] != "subscription conflicts are unavailable right now; try again later" {
				t.Errorf("status = %d, %v; want 503", code, resp)
			}
		})
	}
}
