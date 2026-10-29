package subscription

import "context"

// Snapshot is the stored subscription display for /billing/me.
// It does not assess live Stripe state or confer entitlement.
type Snapshot struct {
	Status           string
	Plan             string
	CurrentPeriodEnd int64
}

// Reader supplies the accepted stored snapshot at cutover.
// Absence returns status "none", an empty plan and a zero period end;
// database failures return an error.
type Reader interface {
	Subscription(ctx context.Context, userID string) (Snapshot, error)
}
