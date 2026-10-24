package webhookevent

import (
	"errors"
	"math"
	"testing"
	"time"
)

func TestLivemodeForAPIKey(t *testing.T) {
	cases := []struct {
		key      string
		livemode bool
	}{
		{"sk_live_abc", true},
		{"rk_live_abc", true},
		{"sk_test_abc", false},
		{"rk_test_abc", false},
	}
	for _, tc := range cases {
		got, err := LivemodeForAPIKey(tc.key)
		if err != nil || got != tc.livemode {
			t.Errorf("LivemodeForAPIKey(%q) = %v, %v; want %v, nil", tc.key, got, err, tc.livemode)
		}
	}
}

func TestLivemodeForAPIKeyRefusesUnknownPrefixes(t *testing.T) {
	for _, key := range []string{"", "pk_live_abc", "pk_test_abc", "sk_abc", "whsec_abc", "SK_LIVE_abc", "sk_live"} {
		if _, err := LivemodeForAPIKey(key); !errors.Is(err, ErrUnknownKeyPrefix) {
			t.Errorf("LivemodeForAPIKey(%q) error = %v, want ErrUnknownKeyPrefix", key, err)
		}
	}
}

func TestEndpointAdmit(t *testing.T) {
	live := Endpoint{AccountID: "acct_enx", Livemode: true}
	cases := []struct {
		name     string
		account  string
		livemode bool
		want     error
	}{
		{"a direct event with no account uses the endpoint's", "", true, nil},
		{"a matching explicit account", "acct_enx", true, nil},
		{"another account", "acct_other", true, ErrWrongAccount},
		{"the other mode", "", false, ErrWrongMode},
		{"another account in the other mode", "acct_other", false, ErrWrongAccount},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := live.Admit(tc.account, tc.livemode); !errors.Is(err, tc.want) {
				t.Errorf("Admit(%q, %v) = %v, want %v", tc.account, tc.livemode, err, tc.want)
			}
		})
	}
}

func TestEndpointWithoutAnAccountAdmitsNothing(t *testing.T) {
	if err := (Endpoint{Livemode: false}).Admit("", false); !errors.Is(err, ErrEndpointUnknown) {
		t.Errorf("Admit before account discovery = %v, want ErrEndpointUnknown", err)
	}
}

func TestEndpointScopesEventIDs(t *testing.T) {
	test := Endpoint{AccountID: "acct_enx", Livemode: false}
	live := Endpoint{AccountID: "acct_enx", Livemode: true}
	other := Endpoint{AccountID: "acct_other", Livemode: false}
	if test.Scope("evt_1") == live.Scope("evt_1") || test.Scope("evt_1") == other.Scope("evt_1") {
		t.Error("one Event ID in another account or mode must be a different scoped event")
	}
	if got, want := test.Scope("evt_1"), (Scope{AccountID: "acct_enx", Livemode: false, EventID: "evt_1"}); got != want {
		t.Errorf("Scope = %+v, want %+v", got, want)
	}
}

func TestBackoff(t *testing.T) {
	const minDelay, maxDelay = 5 * time.Second, 15 * time.Minute
	cases := []struct {
		attempt int
		want    time.Duration
	}{
		{0, 5 * time.Second},
		{1, 5 * time.Second},
		{2, 10 * time.Second},
		{3, 20 * time.Second},
		{8, 640 * time.Second},
		{9, 15 * time.Minute},
		{1000, 15 * time.Minute},
		{1 << 30, 15 * time.Minute},
	}
	for _, tc := range cases {
		if got := Backoff(tc.attempt, minDelay, maxDelay); got != tc.want {
			t.Errorf("Backoff(%d) = %v, want %v", tc.attempt, got, tc.want)
		}
	}
}

func TestBackoffSaturatesAtAHugeCap(t *testing.T) {
	const maxDelay = time.Duration(math.MaxInt64)
	if got := Backoff(100, 5*time.Second, maxDelay); got != maxDelay {
		t.Errorf("Backoff(100) = %v, want %v", got, maxDelay)
	}
}

func TestAfterMissingDependency(t *testing.T) {
	const deadline = 24 * time.Hour
	first := time.Date(2026, 10, 24, 1, 0, 0, 0, time.UTC)

	t.Run("the first wait starts the clock", func(t *testing.T) {
		status, since := AfterMissingDependency(time.Time{}, first, deadline)
		if status != WaitingDependency || !since.Equal(first) {
			t.Errorf("got %s since %v, want %s since %v", status, since, WaitingDependency, first)
		}
	})
	t.Run("a later retry or redelivery keeps the first wait", func(t *testing.T) {
		status, since := AfterMissingDependency(first, first.Add(23*time.Hour), deadline)
		if status != WaitingDependency || !since.Equal(first) {
			t.Errorf("got %s since %v, want %s since %v", status, since, WaitingDependency, first)
		}
	})
	t.Run("at the deadline the event needs attention", func(t *testing.T) {
		status, since := AfterMissingDependency(first, first.Add(deadline), deadline)
		if status != NeedsAttention || !since.Equal(first) {
			t.Errorf("got %s since %v, want %s since %v", status, since, NeedsAttention, first)
		}
	})
}
