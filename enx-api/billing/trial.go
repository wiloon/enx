package billing

import (
	"context"
	"time"

	"enx-api/billing/credit"
	"enx-api/utils/logger"
)

// TrialGrant is the new-user hook that gives every new account the sign-up
// trial (ADR-048 Decision 3), once per email (ADR-062 Decision 3). An Amount
// of 0 is the "trials off" switch.
type TrialGrant struct {
	Amount int64
	TTL    time.Duration
	// EmailHMAC is account.EmailHMAC.Of: "" when the email is blank or no
	// key is configured, and then no trial is granted.
	EmailHMAC func(email string) string
	// Observe, when set, is called once per grant actually made (the
	// enx_trial_grants_total metric).
	Observe func()
}

func (g TrialGrant) NewUser(ctx context.Context, userID, email string) error {
	h := g.EmailHMAC(email)
	if h == "" && g.Amount > 0 {
		logger.Warnf("trial: not granted to user %s: no email HMAC (blank email or account.email-hmac-key unset)", userID)
	}
	granted, err := credit.GrantTrial(ctx, userID, h, g.Amount, g.TTL)
	if granted && g.Observe != nil {
		g.Observe()
	}
	return err
}
