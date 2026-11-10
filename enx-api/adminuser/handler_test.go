package adminuser

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func adminUsersAPI(store Store) *gin.Engine {
	gin.SetMode(gin.TestMode)
	h := NewHandler(NewService(store, false, func() time.Time { return now }))
	r := gin.New()
	r.GET("/users", h.List)
	r.GET("/users/:id", h.Detail)
	r.GET("/users/:id/transactions", h.Transactions)
	return r
}

func get(r *gin.Engine, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

func TestListAnswersEachUserWithBalancesAndTotals(t *testing.T) {
	east := time.FixedZone("UTC+8", 8*3600)
	trialEnds := now.Add(time.Hour)
	store := &fakeStore{
		accounts: []Account{{
			UserID: "u1", Email: "a@example.com", Name: "Ann", Status: "active",
			CreatedAt: time.Date(2026, 10, 1, 8, 0, 0, 0, east), Plan: "pro", SubscriptionStatus: "active",
			SubscriptionBalance: 100, TopupBalance: 20, TrialBalance: 50, TrialExpiresAt: &trialEnds,
		}},
		ledger: []Transaction{row("u1", "GRANT_TOPUP", 300), row("u1", "CLAWBACK", -90)},
	}

	w := get(adminUsersAPI(store), "/users")

	want := `{"success":true,"total":1,"users":[{` +
		`"balances":{"subscription":100,"topup":20,"total":170,"trial":50,"trialExpiresAt":"2026-10-16T13:00:00Z"},` +
		`"createdAt":"2026-10-01T00:00:00Z","email":"a@example.com","hadClawback":true,"id":"u1","lastLoginAt":null,` +
		`"name":"Ann","plan":"pro","status":"active","subscriptionStatus":"active",` +
		`"totals":{"clawedBack":90,"consumed":0,"gifted":0,"paid":300,"trial":0}}]}`
	if w.Code != http.StatusOK || w.Body.String() != want {
		t.Fatalf("got %d %s\nwant 200 %s", w.Code, w.Body.String(), want)
	}
}

func TestListHandsTheSearchSortAndPageToTheStore(t *testing.T) {
	store := &recordingStore{}

	if w := get(adminUsersAPI(store), "/users?q=ex&sort=balance&limit=5&offset=10"); w.Code != http.StatusOK {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
	if want := (ListQuery{Query: "ex", Sort: SortBalance, Limit: 5, Offset: 10}); store.got != want {
		t.Fatalf("store query = %+v, want %+v", store.got, want)
	}
}

func TestListRejectsBadParameters(t *testing.T) {
	for _, query := range []string{"sort=email", "limit=abc", "offset=x"} {
		if w := get(adminUsersAPI(&fakeStore{}), "/users?"+query); w.Code != http.StatusBadRequest {
			t.Errorf("?%s: status %d %s, want 400", query, w.Code, w.Body.String())
		}
	}
}

func TestDetailAnswersTheUserWithUsageAndAISpendBiggestFirst(t *testing.T) {
	store := &fakeStore{
		accounts: []Account{{UserID: "u1", Email: "a@example.com", StripeCustomerID: "cus_1"}},
		lookups:  map[string]map[string]int64{"u1": {"2026-10-16": 4}},
		spend:    map[string]map[string]int64{"u1": {"rephrase": 30, "translate_sentence": 120, "idiom_notes": 30}},
	}

	w := get(adminUsersAPI(store), "/users/u1")

	var body struct {
		User         map[string]any
		DailyLookups []struct {
			Date  string
			Count int64
		}
		AISpend []struct {
			Feature string
			Credits int64
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || w.Code != http.StatusOK {
		t.Fatalf("got %d %s (%v)", w.Code, w.Body.String(), err)
	}
	if body.User["id"] != "u1" || body.User["stripeCustomerId"] != "cus_1" ||
		body.User["stripeDashboardUrl"] != "https://dashboard.stripe.com/test/customers/cus_1" {
		t.Fatalf("user = %v", body.User)
	}
	if n := len(body.DailyLookups); n != UsageDays || body.DailyLookups[n-1].Date != "2026-10-16" || body.DailyLookups[n-1].Count != 4 {
		t.Fatalf("dailyLookups = %+v, want %d days ending 2026-10-16 with 4", body.DailyLookups, UsageDays)
	}
	if got, want := fmt.Sprint(body.AISpend), "[{translate_sentence 120} {idiom_notes 30} {rephrase 30}]"; got != want {
		t.Fatalf("aiSpend = %s, want %s (biggest first, ties by feature)", got, want)
	}
}

func TestDetailOfAnUnknownUserIsNotFound(t *testing.T) {
	if w := get(adminUsersAPI(&fakeStore{}), "/users/nobody"); w.Code != http.StatusNotFound {
		t.Fatalf("status %d %s, want 404", w.Code, w.Body.String())
	}
}

// ADR-063 Decision 3: the admin's timeline keeps every field the user's own
// history drops, plus each row's source.
func TestTransactionsAnswerEachRowWithTheAdminsFields(t *testing.T) {
	store := &fakeStore{
		accounts: []Account{{UserID: "u1"}},
		ledger: []Transaction{
			{ID: "t1", Seq: 1, UserID: "u1", Type: "CLAWBACK", Amount: -90, BalanceAfter: 210, Note: "ch_1",
				CreatedAt: time.Date(2026, 10, 16, 20, 0, 0, 0, time.FixedZone("UTC+8", 8*3600))},
		},
	}

	w := get(adminUsersAPI(store), "/users/u1/transactions?limit=1")

	want := `{"next":"1792152000000_1","success":true,"transactions":[{"amount":-90,"balanceAfter":210,` +
		`"createdAt":"2026-10-16T12:00:00Z","feature":"","id":"t1","note":"ch_1","source":"refund","totalBalanceAfter":null,"type":"CLAWBACK"}]}`
	if w.Code != http.StatusOK || w.Body.String() != want {
		t.Fatalf("got %d %s\nwant 200 %s", w.Code, w.Body.String(), want)
	}
}

func TestTransactionsMapEachRefusalToItsStatus(t *testing.T) {
	store := &fakeStore{accounts: []Account{{UserID: "u1"}}}
	for _, tc := range []struct {
		path string
		want int
	}{
		{"/users/nobody/transactions", http.StatusNotFound},
		{"/users/u1/transactions?before=not-a-cursor", http.StatusBadRequest},
		{"/users/u1/transactions?direction=added", http.StatusBadRequest},
		{"/users/nobody/transactions?direction=added", http.StatusBadRequest},
		{"/users/u1/transactions?limit=abc", http.StatusBadRequest},
	} {
		if w := get(adminUsersAPI(store), tc.path); w.Code != tc.want {
			t.Errorf("%s: status %d %s, want %d", tc.path, w.Code, w.Body.String(), tc.want)
		}
	}
}
