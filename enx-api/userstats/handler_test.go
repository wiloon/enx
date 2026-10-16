package userstats

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type fakeDaily struct {
	calls []string // "from..to" per call
	err   error
}

func (f *fakeDaily) Daily(_ context.Context, from, to string) ([]Day, error) {
	f.calls = append(f.calls, from+".."+to)
	if f.err != nil {
		return nil, f.err
	}
	return []Day{{Date: "2026-10-12", UsersTotal: 120, NewUsers: 3, DAU: 41, WAU: 77, MAU: 98}}, nil
}

const token = "s3cret-token"

func get(h *DailyHandler, query, auth string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/ops/user-stats/daily", h.Serve)
	req := httptest.NewRequest(http.MethodGet, "/api/ops/user-stats/daily"+query, nil)
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestDailyEndpointReturnsTheDays(t *testing.T) {
	src := &fakeDaily{}
	w := get(NewDailyHandler(src, token, time.Now), "?from=2026-10-12&to=2026-10-12", "Bearer "+token)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body)
	}
	var got []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"date": "2026-10-12", "users_total": 120.0, "new_users": 3.0, "dau": 41.0, "wau": 77.0, "mau": 98.0}
	if len(got) != 1 || fmt.Sprint(got[0]) != fmt.Sprint(want) {
		t.Fatalf("body = %s, want [%v]", w.Body, want)
	}
	if len(src.calls) != 1 || src.calls[0] != "2026-10-12..2026-10-12" {
		t.Errorf("Daily called with %v, want 2026-10-12..2026-10-12", src.calls)
	}
}

func TestDailyEndpointNeedsTheToken(t *testing.T) {
	for _, tc := range []struct{ name, auth string }{
		{"missing", ""},
		{"wrong", "Bearer not-the-token"},
		{"not bearer", token},
		{"prefix of the token", "Bearer s3cret"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			src := &fakeDaily{}
			w := get(NewDailyHandler(src, token, time.Now), "", tc.auth)
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", w.Code)
			}
			if len(src.calls) != 0 {
				t.Errorf("Daily was called without a valid token")
			}
		})
	}
}

// Without OPS_STATS_TOKEN the endpoint does not exist (ADR-058 Decision 4).
func TestDailyEndpointIsNotFoundWithoutAConfiguredToken(t *testing.T) {
	for _, auth := range []string{"", "Bearer ", "Bearer anything"} {
		w := get(NewDailyHandler(&fakeDaily{}, "", time.Now), "", auth)
		if w.Code != http.StatusNotFound {
			t.Errorf("Authorization %q: status = %d, want 404", auth, w.Code)
		}
	}
}

func TestDailyEndpointRejectsABadRange(t *testing.T) {
	src := &fakeDaily{err: fmt.Errorf("%w: from is after to", ErrBadRange)}
	w := get(NewDailyHandler(src, token, time.Now), "?from=2026-10-16&to=2026-10-15", "Bearer "+token)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

func TestDailyEndpointCachesEachRangeForFiveMinutes(t *testing.T) {
	clock := time.Date(2026, 10, 16, 1, 0, 0, 0, time.UTC)
	src := &fakeDaily{}
	h := NewDailyHandler(src, token, func() time.Time { return clock })
	auth := "Bearer " + token

	get(h, "?from=2026-10-01", auth)
	get(h, "?from=2026-10-01", auth)
	get(h, "?from=2026-10-02", auth)
	if len(src.calls) != 2 {
		t.Fatalf("Daily called %v, want once per range", src.calls)
	}
	clock = clock.Add(5 * time.Minute)
	get(h, "?from=2026-10-01", auth)
	if len(src.calls) != 3 {
		t.Fatalf("Daily called %v, want a fresh query after five minutes", src.calls)
	}
}
