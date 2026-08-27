package utils

import (
	"testing"
	"time"
)

func TestTimeToMicroSecond(t *testing.T) {
	tm := time.Date(2026, 1, 2, 3, 4, 5, 6000, time.UTC) // 6000ns = 6us
	got := TimeToMicroSecond(tm)
	want := tm.UnixNano() / int64(time.Microsecond)
	if got != want {
		t.Errorf("got %d, want %d", got, want)
	}
}

func TestTimeNowMicrosecond(t *testing.T) {
	before := time.Now().UnixNano() / int64(time.Microsecond)
	got := TimeNowMicrosecond()
	after := time.Now().UnixNano() / int64(time.Microsecond)

	if got < before || got > after {
		t.Errorf("expected %d to be between %d and %d", got, before, after)
	}
}
