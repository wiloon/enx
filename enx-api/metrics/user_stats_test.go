package metrics

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"enx-api/userstats"
)

type fakeUserStats struct {
	snap  userstats.Snapshot
	err   error
	calls int
}

func (f *fakeUserStats) Current(context.Context) (userstats.Snapshot, error) {
	f.calls++
	return f.snap, f.err
}

func TestUserStatsGauges(t *testing.T) {
	m := New()
	m.RegisterUserStats(&fakeUserStats{snap: userstats.Snapshot{
		UsersTotal: 120,
		Active:     userstats.Counts{Day: 41, Week: 77, Month: 98},
		New:        userstats.Counts{Day: 3, Week: 9, Month: 30},
	}}, time.Now)

	out := exposition(t, m)
	for _, want := range []string{
		"enx_users_total 120",
		`enx_active_users{window="1d"} 41`,
		`enx_active_users{window="7d"} 77`,
		`enx_active_users{window="30d"} 98`,
		`enx_new_users{window="1d"} 3`,
		`enx_new_users{window="7d"} 9`,
		`enx_new_users{window="30d"} 30`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("exposition lacks %q", want)
		}
	}
}

// A scrape within five minutes of the last query reuses its numbers instead
// of querying SQLite again (ADR-058 Decision 3).
func TestUserStatsAreCachedForFiveMinutes(t *testing.T) {
	clock := time.Date(2026, 10, 16, 1, 0, 0, 0, time.UTC)
	src := &fakeUserStats{}
	m := New()
	m.RegisterUserStats(src, func() time.Time { return clock })

	exposition(t, m)
	clock = clock.Add(4*time.Minute + 59*time.Second)
	exposition(t, m)
	if src.calls != 1 {
		t.Fatalf("queried %d times within five minutes, want 1", src.calls)
	}
	clock = clock.Add(time.Second)
	exposition(t, m)
	if src.calls != 2 {
		t.Fatalf("queried %d times after five minutes, want 2", src.calls)
	}
}

// A failed query drops only the user gauges from the scrape; the rest of
// /metrics is still served, and the next scrape tries again.
func TestUserStatsFailureKeepsTheScrapeUp(t *testing.T) {
	src := &fakeUserStats{err: errors.New("database is locked")}
	m := New()
	m.RegisterUserStats(src, time.Now)

	w := httptest.NewRecorder()
	m.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("scrape status = %d, want 200", w.Code)
	}
	out := w.Body.String()
	if strings.Contains(out, "enx_users_total") || !strings.Contains(out, "go_goroutines") {
		t.Errorf("want the user gauges left out and the runtime metrics kept, got:\n%s", out)
	}
	exposition(t, m)
	if src.calls != 2 {
		t.Errorf("queried %d times, want a retry on the next scrape", src.calls)
	}
}
