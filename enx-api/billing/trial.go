package billing

import (
	"context"
	"time"

	"enx-api/billing/credit"
)

// TrialGrant is the new-user hook that gives every new account the sign-up
// trial (ADR-048 Decision 3). An Amount of 0 is the "trials off" switch.
type TrialGrant struct {
	Amount int64
	TTL    time.Duration
	// Observe, when set, is called once per grant actually made (the
	// enx_trial_grants_total metric).
	Observe func()
}

func (g TrialGrant) NewUser(ctx context.Context, userID string) error {
	granted, err := credit.GrantTrial(ctx, userID, g.Amount, g.TTL)
	if granted && g.Observe != nil {
		g.Observe()
	}
	return err
}
