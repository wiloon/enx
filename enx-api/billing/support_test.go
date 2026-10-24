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

	"enx-api/billing/billingsupport"
	"enx-api/billing/conflict"

	"github.com/gin-gonic/gin"
)

var supportNow = time.Date(2026, 10, 24, 9, 0, 0, 0, time.UTC)

// supportStore holds one owned conflict, sub_b of user_1, and counts the
// support requests saved on it.
type supportStore struct {
	row   billingsupport.Record
	saves int
	err   error
}

func newSupportStore() *supportStore {
	return &supportStore{row: billingsupport.Record{Subscription: conflict.Subscription{OwnerID: "user_1", Conflict: true}}}
}

func (s *supportStore) Subscription(_ context.Context, id string) (billingsupport.Record, error) {
	if s.err != nil {
		return billingsupport.Record{}, s.err
	}
	if id != "sub_b" {
		return billingsupport.Record{}, billingsupport.ErrNotFound
	}
	return s.row, nil
}

func (s *supportStore) SaveSupport(_ context.Context, save billingsupport.Save) error {
	s.saves++
	s.row.Version++
	s.row.Subscription.Support = save.Support
	s.row.Alert = save.Alert
	return nil
}

type supportResponse struct {
	Success        bool   `json:"success"`
	Message        string `json:"message"`
	SupportRequest *struct {
		Message string `json:"message"`
		SentAt  string `json:"sentAt"`
	} `json:"supportRequest"`
}

func postSupport(t *testing.T, store *supportStore, userID, body string) (int, supportResponse) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	service := billingsupport.New(store, func() time.Time { return supportNow })
	router.POST("/api/billing/support", setUserID(userID), NewSupportHandler(service).Submit)
	req := httptest.NewRequest(http.MethodPost, "/api/billing/support", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	var resp supportResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	return w.Code, resp
}

func TestASupportRequestOnTheUsersConflictIsSavedAndConfirmed(t *testing.T) {
	store := newSupportStore()

	code, resp := postSupport(t, store, "user_1", `{"subscriptionId":"sub_b","message":"I was charged twice."}`)

	if code != http.StatusOK || !resp.Success {
		t.Fatalf("status = %d, success %v; want 200", code, resp.Success)
	}
	if resp.Message != "Your message was sent. An administrator will look into your subscription." {
		t.Errorf("message = %q", resp.Message)
	}
	if resp.SupportRequest == nil || resp.SupportRequest.Message != "I was charged twice." || resp.SupportRequest.SentAt != "2026-10-24T09:00:00Z" {
		t.Errorf("supportRequest = %+v, want the saved message and time", resp.SupportRequest)
	}
	if store.saves != 1 {
		t.Errorf("saves = %d, want 1", store.saves)
	}
}

func TestARepeatedSupportRequestAnswersWithTheFirstAndSavesNothingMore(t *testing.T) {
	store := newSupportStore()
	postSupport(t, store, "user_1", `{"subscriptionId":"sub_b","message":"I was charged twice."}`)

	code, resp := postSupport(t, store, "user_1", `{"subscriptionId":"sub_b","message":"Hello again?"}`)

	if code != http.StatusOK || resp.SupportRequest == nil || resp.SupportRequest.Message != "I was charged twice." {
		t.Errorf("status = %d, supportRequest %+v; want 200 with the first message", code, resp.SupportRequest)
	}
	if store.saves != 1 {
		t.Errorf("saves = %d, want only the first", store.saves)
	}
}

func TestARefusedSupportRequestSavesNothing(t *testing.T) {
	cases := []struct {
		name     string
		userID   string
		body     string
		wantCode int
		wantMsg  string
	}{
		{"another user's subscription", "user_2", `{"subscriptionId":"sub_b","message":"Not mine."}`,
			http.StatusNotFound, "No subscription issue was found for your account."},
		{"an unknown subscription", "user_1", `{"subscriptionId":"sub_x","message":"Help."}`,
			http.StatusNotFound, "No subscription issue was found for your account."},
		{"a blank message", "user_1", `{"subscriptionId":"sub_b","message":"  "}`,
			http.StatusBadRequest, "Please enter a message."},
		{"a message over 2000 characters", "user_1", `{"subscriptionId":"sub_b","message":"` + strings.Repeat("a", 2001) + `"}`,
			http.StatusBadRequest, "Your message must be at most 2000 characters."},
		{"a body that is not JSON", "user_1", `subscriptionId=sub_b`,
			http.StatusBadRequest, "A subscription ID and a message are required."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newSupportStore()

			code, resp := postSupport(t, store, tc.userID, tc.body)

			if code != tc.wantCode || resp.Success || resp.Message != tc.wantMsg {
				t.Errorf("status = %d, %+v; want %d %q", code, resp, tc.wantCode, tc.wantMsg)
			}
			if store.saves != 0 {
				t.Errorf("saves = %d, want none", store.saves)
			}
		})
	}
}

func TestASupportRequestTheStoreCannotServeIsAnswered503(t *testing.T) {
	store := newSupportStore()
	store.err = errors.New("database is locked")

	code, resp := postSupport(t, store, "user_1", `{"subscriptionId":"sub_b","message":"Help."}`)

	if code != http.StatusServiceUnavailable || resp.Success || resp.Message != "Your message could not be sent right now. Please try again later." {
		t.Errorf("status = %d, %+v; want 503 with retry copy", code, resp)
	}
}
