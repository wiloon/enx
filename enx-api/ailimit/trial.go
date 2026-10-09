package ailimit

import (
	"context"

	"enx-api/entitlement"
	"enx-api/utils/logger"
)

// Verdict is a limiter's answer to "may this user make another AI call?".
type Verdict int

const (
	Allowed Verdict = iota
	LimitedPerMinute
	LimitedPerDay
)

func (v Verdict) String() string {
	switch v {
	case Allowed:
		return "allowed"
	case LimitedPerMinute:
		return "limited-per-minute"
	case LimitedPerDay:
		return "limited-per-day"
	}
	return "unknown"
}

// StatusSource is the entitlement judgement the gate asks who is a
// trial-only user.
type StatusSource interface {
	Status(ctx context.Context, userID string) (entitlement.Status, error)
}

// TrialGate holds users whose AI access comes from the sign-up trial alone
// to the trial's call rate (ADR-048 Decision 7); everyone else passes
// untouched. It runs before the credit pre-check, so a refused call costs
// nothing. A nil *TrialGate allows everything.
type TrialGate struct {
	status  StatusSource
	limiter *MemoryLimiter
}

func NewTrialGate(status StatusSource, limiter *MemoryLimiter) *TrialGate {
	return &TrialGate{status: status, limiter: limiter}
}

// Check counts the call against userID's trial limits when they are a
// trial-only user. It fails open: an unreadable status leaves the call to
// the credit pre-check, which is the real cost ceiling.
func (g *TrialGate) Check(ctx context.Context, userID string) Verdict {
	if g == nil {
		return Allowed
	}
	status, err := g.status.Status(ctx, userID)
	if err != nil {
		logger.Warnf("ailimit: trial status check failed for user %s, not limiting: %v", userID, err)
		return Allowed
	}
	if !status.TrialOnly {
		return Allowed
	}
	return g.limiter.Decide(userID)
}
