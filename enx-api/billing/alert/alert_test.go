package alert

import (
	"errors"
	"testing"
	"time"
)

var (
	t0    = time.Date(2026, 10, 24, 9, 0, 0, 0, time.UTC)
	lease = 2 * time.Minute
	hour  = time.Hour
)

func TestRaise(t *testing.T) {
	sent := Alert{State: Sent, Attempts: 1, SentAt: t0}
	pending := Alert{State: Pending, Attempts: 3, LastError: "resend: 500", NextAttemptAt: t0.Add(hour)}

	cases := []struct {
		name    string
		current Alert
		want    Alert
	}{
		{name: "a first raise makes the alert pending and due at once", current: Alert{}, want: Alert{State: Pending, NextAttemptAt: t0}},
		{name: "raising a sent alert again sends nothing more", current: sent, want: sent},
		{name: "raising a pending alert again keeps its attempts and schedule", current: pending, want: pending},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Raise(tc.current, t0); got != tc.want {
				t.Errorf("Raise = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestDue(t *testing.T) {
	cases := []struct {
		name        string
		alert       Alert
		now         time.Time
		wantHourly  bool
		wantStartup bool
	}{
		{name: "no alert is never due", alert: Alert{}, now: t0},
		{name: "a sent alert is never due", alert: Alert{State: Sent, SentAt: t0}, now: t0.Add(hour)},
		{
			name:        "a fresh pending alert is due",
			alert:       Alert{State: Pending, NextAttemptAt: t0},
			now:         t0,
			wantHourly:  true,
			wantStartup: true,
		},
		{
			name:        "a failed alert waits for its next attempt, except at startup",
			alert:       Alert{State: Pending, Attempts: 1, NextAttemptAt: t0.Add(hour)},
			now:         t0.Add(10 * time.Minute),
			wantStartup: true,
		},
		{
			name:        "a failed alert is due again at its next attempt",
			alert:       Alert{State: Pending, Attempts: 1, NextAttemptAt: t0.Add(hour)},
			now:         t0.Add(hour),
			wantHourly:  true,
			wantStartup: true,
		},
		{
			name:  "a live claim keeps every other notifier away",
			alert: Alert{State: Pending, NextAttemptAt: t0, ClaimToken: "tok_a", ClaimExpiresAt: t0.Add(lease)},
			now:   t0.Add(time.Minute),
		},
		{
			name:        "an expired claim is recovered",
			alert:       Alert{State: Pending, NextAttemptAt: t0, ClaimToken: "tok_a", ClaimExpiresAt: t0.Add(lease)},
			now:         t0.Add(lease),
			wantHourly:  true,
			wantStartup: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.alert.Due(tc.now, HourlyPass); got != tc.wantHourly {
				t.Errorf("Due(hourly) = %v, want %v", got, tc.wantHourly)
			}
			if got := tc.alert.Due(tc.now, StartupPass); got != tc.wantStartup {
				t.Errorf("Due(startup) = %v, want %v", got, tc.wantStartup)
			}
		})
	}
}

func TestClaim(t *testing.T) {
	due := Alert{State: Pending, NextAttemptAt: t0}

	got, err := Claim(due, "tok_a", t0, lease, HourlyPass)
	if err != nil {
		t.Fatal(err)
	}
	want := Alert{State: Pending, NextAttemptAt: t0, ClaimToken: "tok_a", ClaimExpiresAt: t0.Add(lease)}
	if got != want {
		t.Errorf("Claim = %+v, want %+v", got, want)
	}

	if _, err := Claim(got, "tok_b", t0.Add(time.Minute), lease, HourlyPass); !errors.Is(err, ErrNotDue) {
		t.Errorf("second notifier's Claim err = %v, want ErrNotDue", err)
	}
	if _, err := Claim(Alert{State: Sent, SentAt: t0}, "tok_b", t0, lease, StartupPass); !errors.Is(err, ErrNotDue) {
		t.Errorf("Claim of a sent alert err = %v, want ErrNotDue", err)
	}
	if _, err := Claim(due, "", t0, lease, HourlyPass); !errors.Is(err, ErrNoToken) {
		t.Errorf("Claim without a token err = %v, want ErrNoToken", err)
	}
}

func TestMarkSent(t *testing.T) {
	claimed := Alert{State: Pending, Attempts: 2, LastError: "resend: 500", NextAttemptAt: t0, ClaimToken: "tok_a", ClaimExpiresAt: t0.Add(lease)}

	got, err := MarkSent(claimed, "tok_a", t0.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	want := Alert{State: Sent, Attempts: 3, LastError: "", SentAt: t0.Add(time.Minute)}
	if got != want {
		t.Errorf("MarkSent = %+v, want %+v", got, want)
	}

	t.Run("a notifier whose claim was taken over cannot mark it sent", func(t *testing.T) {
		reclaimed := claimed
		reclaimed.ClaimToken = "tok_b"
		if _, err := MarkSent(reclaimed, "tok_a", t0.Add(3*time.Minute)); !errors.Is(err, ErrStaleClaim) {
			t.Errorf("err = %v, want ErrStaleClaim", err)
		}
	})
	t.Run("an unclaimed alert cannot be marked sent", func(t *testing.T) {
		if _, err := MarkSent(Alert{State: Pending, NextAttemptAt: t0}, "tok_a", t0); !errors.Is(err, ErrStaleClaim) {
			t.Errorf("err = %v, want ErrStaleClaim", err)
		}
	})
}

func TestMarkFailed(t *testing.T) {
	claimed := Alert{State: Pending, Attempts: 2, NextAttemptAt: t0, ClaimToken: "tok_a", ClaimExpiresAt: t0.Add(lease)}

	got, err := MarkFailed(claimed, "tok_a", t0.Add(time.Minute), "resend: sender not configured", hour)
	if err != nil {
		t.Fatal(err)
	}
	want := Alert{State: Pending, Attempts: 3, LastError: "resend: sender not configured", NextAttemptAt: t0.Add(time.Minute + hour)}
	if got != want {
		t.Errorf("MarkFailed = %+v, want %+v", got, want)
	}

	t.Run("a failed alert stays pending however often it fails", func(t *testing.T) {
		a := got
		for i := range 50 {
			now := a.NextAttemptAt
			a, err = Claim(a, "tok", now, lease, HourlyPass)
			if err != nil {
				t.Fatalf("attempt %d: Claim: %v", i, err)
			}
			a, err = MarkFailed(a, "tok", now, "resend: 500", hour)
			if err != nil {
				t.Fatalf("attempt %d: MarkFailed: %v", i, err)
			}
		}
		if a.State != Pending || a.Attempts != 53 {
			t.Errorf("after 50 more failures: %+v, want pending with 53 attempts", a)
		}
	})
	t.Run("a notifier whose claim was taken over cannot record its failure", func(t *testing.T) {
		reclaimed := claimed
		reclaimed.ClaimToken = "tok_b"
		if _, err := MarkFailed(reclaimed, "tok_a", t0, "late", hour); !errors.Is(err, ErrStaleClaim) {
			t.Errorf("err = %v, want ErrStaleClaim", err)
		}
	})
}
