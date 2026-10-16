package ailimit

import (
	"testing"
	"time"
)

// The daily trial limit resets at UTC midnight, which is a different time of
// day for every user, so the 429 says how long to wait rather than
// "tomorrow" (ADR-048 Decision 7).
func TestDayLimitMessageCountsHoursToUTCMidnight(t *testing.T) {
	for _, tc := range []struct {
		at   string
		want string
	}{
		{"2026-10-16T19:00:00Z", "You've reached today's trial limit. Try again in 5 hours, or subscribe for more."},
		{"2026-10-16T19:20:00Z", "You've reached today's trial limit. Try again in 5 hours, or subscribe for more."},
		{"2026-10-16T23:59:30Z", "You've reached today's trial limit. Try again in 1 hour, or subscribe for more."},
		{"2026-10-16T00:00:00Z", "You've reached today's trial limit. Try again in 24 hours, or subscribe for more."},
		{"2026-10-16T23:00:00+08:00", "You've reached today's trial limit. Try again in 9 hours, or subscribe for more."},
	} {
		at, err := time.Parse(time.RFC3339, tc.at)
		if err != nil {
			t.Fatal(err)
		}
		if got := DayLimitMessage(at); got != tc.want {
			t.Errorf("DayLimitMessage(%s) = %q, want %q", tc.at, got, tc.want)
		}
	}
}
