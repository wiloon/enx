package ailimit

import (
	"context"
	"errors"
	"testing"

	"enx-api/entitlement"
)

type fakeStatus struct {
	status entitlement.Status
	err    error
}

func (f fakeStatus) Status(context.Context, string) (entitlement.Status, error) {
	return f.status, f.err
}

func TestTrialGateLimitsTrialOnlyUsers(t *testing.T) {
	clock := newClock()
	gate := NewTrialGate(fakeStatus{status: entitlement.Status{CanUseAI: true, TrialOnly: true}},
		NewMemoryLimiter(Limits{CallsPerMinute: 1, CallsPerDay: 2}, clock.now))
	ctx := context.Background()

	if got := gate.Check(ctx, "u1"); got != Allowed {
		t.Fatalf("first call = %v, want Allowed", got)
	}
	if got := gate.Check(ctx, "u1"); got != LimitedPerMinute {
		t.Fatalf("second call in the same minute = %v, want LimitedPerMinute", got)
	}
	clock.advance(61e9)
	if got := gate.Check(ctx, "u1"); got != Allowed {
		t.Fatalf("call a minute later = %v, want Allowed", got)
	}
	clock.advance(61e9)
	if got := gate.Check(ctx, "u1"); got != LimitedPerDay {
		t.Fatalf("third call of the day = %v, want LimitedPerDay", got)
	}
}

func TestTrialGateLeavesPayingUsersAlone(t *testing.T) {
	for name, status := range map[string]entitlement.Status{
		"subscriber": {Subscribed: true, CanUseAI: true},
		"top-up":     {CanUseAI: true},
	} {
		t.Run(name, func(t *testing.T) {
			gate := NewTrialGate(fakeStatus{status: status}, NewMemoryLimiter(Limits{CallsPerMinute: 1}, newClock().now))
			for i := 0; i < 3; i++ {
				if got := gate.Check(context.Background(), "u1"); got != Allowed {
					t.Fatalf("call %d = %v, want Allowed", i+1, got)
				}
			}
		})
	}
}

// The gate is a safety valve, not the credit check: if the status can't be
// read, the call goes on to the balance pre-check rather than failing.
func TestTrialGateAllowsWhenStatusUnreadable(t *testing.T) {
	gate := NewTrialGate(fakeStatus{err: errors.New("db down")}, NewMemoryLimiter(Limits{CallsPerMinute: 1}, newClock().now))
	for i := 0; i < 2; i++ {
		if got := gate.Check(context.Background(), "u1"); got != Allowed {
			t.Fatalf("call %d = %v, want Allowed", i+1, got)
		}
	}
}

func TestNilTrialGateAllowsEverything(t *testing.T) {
	var gate *TrialGate
	if got := gate.Check(context.Background(), "u1"); got != Allowed {
		t.Fatalf("nil gate = %v, want Allowed", got)
	}
}
