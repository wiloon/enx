package referral

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Reason is why a claim was refused; it is also the API's reason code and
// the claims metric's label.
type Reason string

const (
	ReasonClaimWindowClosed Reason = "claim_window_closed"
	ReasonAlreadyClaimed    Reason = "already_claimed"
	ReasonCodeNotFound      Reason = "code_not_found"
	ReasonOwnCode           Reason = "own_code"
	ReasonAlreadyPaid       Reason = "already_paid"
)

// ClaimError is a claim the rules refused.
type ClaimError struct {
	Reason Reason
}

func (e *ClaimError) Error() string { return "referral: claim refused: " + string(e.Reason) }

// codeAlphabet is base32 without the look-alikes 0, 1, I and O.
const codeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

const codeLength = 8

// Service holds the referral rules.
type Service struct {
	codes     CodeRepo
	referrals ReferralRepo
	accounts  AccountRepo
	credits   CreditGranter
	payments  PaymentChecker
	now       Clock
	policy    CreditPolicy
	observer  Observer
	// newCode draws a random invite code; tests replace it.
	newCode func() string
}

// NewService builds the service. payments may be nil when Stripe is not
// configured; PayDueRewards then fails and every reward stays pending.
func NewService(codes CodeRepo, referrals ReferralRepo, accounts AccountRepo, credits CreditGranter,
	payments PaymentChecker, now Clock, policy CreditPolicy) *Service {
	return &Service{
		codes: codes, referrals: referrals, accounts: accounts, credits: credits,
		payments: payments, now: now, policy: policy, newCode: randomCode,
	}
}

// WithObserver sets who hears claim and reward outcomes.
func (s *Service) WithObserver(o Observer) *Service {
	s.observer = o
	return s
}

func randomCode() string {
	b := make([]byte, codeLength)
	_, _ = rand.Read(b) // never fails (crypto/rand panics instead)
	for i := range b {
		b[i] = codeAlphabet[int(b[i])%len(codeAlphabet)]
	}
	return string(b)
}

// maxCodeAttempts bounds the retries on a code collision, which with 32^8
// codes takes billions of users to be likely at all.
const maxCodeAttempts = 5

// Code returns userID's invite code, creating it on first use.
func (s *Service) Code(ctx context.Context, userID string) (string, error) {
	for range maxCodeAttempts {
		if code, ok, err := s.codes.CodeOf(ctx, userID); err != nil || ok {
			return code, err
		}
		// Not inserted: the code is taken, or a concurrent request just gave
		// this user one. Either way the next round sorts it out.
		if _, err := s.codes.Insert(ctx, userID, s.newCode(), s.now()); err != nil {
			return "", err
		}
	}
	if code, ok, err := s.codes.CodeOf(ctx, userID); err != nil || ok {
		return code, err
	}
	return "", errors.New("referral: could not draw a free invite code")
}

// normalizeCode accepts a code as a person might paste it; "" when it cannot
// be one.
func normalizeCode(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	if len(code) != codeLength {
		return ""
	}
	for _, c := range code {
		if !strings.ContainsRune(codeAlphabet, c) {
			return ""
		}
	}
	return code
}

// ClaimResult is what a successful claim granted. Bonus 0 (and a zero
// TrialExpiresAt) when the invitee bonus is configured off.
type ClaimResult struct {
	Bonus          int64
	TrialExpiresAt time.Time
}

// Claim records that inviteeID joined through code and grants the invitee
// bonus. A refusal is a *ClaimError and grants nothing.
func (s *Service) Claim(ctx context.Context, inviteeID, code string) (ClaimResult, error) {
	res, err := s.claim(ctx, inviteeID, code)
	var ce *ClaimError
	switch {
	case err == nil:
		s.observeClaim("ok")
	case errors.As(err, &ce):
		s.observeClaim(string(ce.Reason))
	}
	return res, err
}

func (s *Service) claim(ctx context.Context, inviteeID, code string) (ClaimResult, error) {
	terms := s.policy.Terms()
	now := s.now()

	created, err := s.accounts.CreatedAt(ctx, inviteeID)
	if err != nil {
		return ClaimResult{}, err
	}
	if !now.Before(created.Add(terms.ClaimWindow)) {
		return ClaimResult{}, &ClaimError{ReasonClaimWindowClosed}
	}
	if _, ok, err := s.referrals.Get(ctx, inviteeID); err != nil {
		return ClaimResult{}, err
	} else if ok {
		return ClaimResult{}, &ClaimError{ReasonAlreadyClaimed}
	}
	code = normalizeCode(code)
	if code == "" {
		return ClaimResult{}, &ClaimError{ReasonCodeNotFound}
	}
	referrerID, ok, err := s.codes.OwnerOf(ctx, code)
	if err != nil {
		return ClaimResult{}, err
	}
	if !ok {
		return ClaimResult{}, &ClaimError{ReasonCodeNotFound}
	}
	if referrerID == inviteeID {
		return ClaimResult{}, &ClaimError{ReasonOwnCode}
	}
	if paid, err := s.accounts.HasPaid(ctx, inviteeID); err != nil {
		return ClaimResult{}, err
	} else if paid {
		return ClaimResult{}, &ClaimError{ReasonAlreadyPaid}
	}

	// A deleted account signed up again links the referral as usual but
	// earns nothing on either side (ADR-062 Decision 3); otherwise deleting
	// and re-registering would farm the referrer reward.
	blocked, err := s.accounts.TrialUsedByAnotherAccount(ctx, inviteeID)
	if err != nil {
		return ClaimResult{}, err
	}

	// The bonus is granted before the referral is stored. Its idempotency
	// key is per invitee, so a claim that then loses a race to a concurrent
	// claim (or fails to store) has granted nothing the winner or a retry
	// would not have; the reverse order could store a referral whose bonus
	// a retry can no longer reach.
	var res ClaimResult
	if terms.InviteeBonus > 0 && !blocked {
		expires, err := s.credits.GrantInviteeBonus(ctx, inviteeID, Bonus{
			Amount:      terms.InviteeBonus,
			ExpiresAt:   created.Add(terms.InviteeTTL),
			TrialAmount: terms.TrialAmount,
			TrialTTL:    terms.TrialTTL,
		})
		if err != nil {
			return ClaimResult{}, err
		}
		res = ClaimResult{Bonus: terms.InviteeBonus, TrialExpiresAt: expires}
	}

	inserted, err := s.referrals.Insert(ctx, Referral{
		InviteeID: inviteeID, ReferrerID: referrerID, Code: code, ClaimedAt: now, Status: StatusClaimed,
		RewardsBlocked: blocked,
	})
	if err != nil {
		return ClaimResult{}, err
	}
	if !inserted {
		return ClaimResult{}, &ClaimError{ReasonAlreadyClaimed}
	}
	return res, nil
}

// Offer is what an invitee gets, for the landing page.
type Offer struct {
	Credits int64
	Days    int
}

// Offer returns the trial plus the invitee bonus and how long they last;
// with the bonus off, the plain trial.
func (s *Service) Offer() Offer {
	t := s.policy.Terms()
	if t.InviteeBonus > 0 {
		return Offer{Credits: t.TrialAmount + t.InviteeBonus, Days: days(t.InviteeTTL)}
	}
	return Offer{Credits: t.TrialAmount, Days: days(t.TrialTTL)}
}

func days(d time.Duration) int { return int(d / (24 * time.Hour)) }

// RecordFirstPayment notes userID's payment if userID was invited and has
// not paid before, and queues the referrer's reward. Any other payment is a
// no-op.
func (s *Service) RecordFirstPayment(ctx context.Context, userID string, p FirstPayment) error {
	terms := s.policy.Terms()
	var amount int64
	switch p.Kind {
	case KindSubscription:
		amount = terms.ReferrerRewardSubscription
	case KindTopup:
		amount = p.Credits * terms.ReferrerRewardTopupPercent / 100
	default:
		return fmt.Errorf("referral: unknown payment kind %q", p.Kind)
	}

	r, ok, err := s.referrals.Get(ctx, userID)
	if err != nil || !ok || r.FirstPayment != nil {
		return err
	}
	if p.PaidAt.IsZero() {
		p.PaidAt = s.now()
	}
	reward := Reward{Status: StatusPending, Amount: amount, DueAt: p.PaidAt.Add(terms.RewardDelay)}
	if amount <= 0 || r.RewardsBlocked {
		reward = Reward{Status: StatusNoReward}
	}
	_, err = s.referrals.RecordFirstPayment(ctx, userID, p, reward)
	return err
}

// RewardRun is what one PayDueRewards pass did. Rows to retry stay pending
// for the next pass; Errors says why.
type RewardRun struct {
	Rewarded  int
	Forfeited int
	Retry     int
	Errors    []error
}

// PayDueRewards settles every reward that is due: forfeited when Stripe
// shows a refund or dispute, otherwise paid into the referrer's top-up pool.
// A row Stripe or the ledger cannot answer for stays pending.
func (s *Service) PayDueRewards(ctx context.Context) (RewardRun, error) {
	if s.payments == nil {
		return RewardRun{}, errors.New("referral: no payment checker (Stripe is not configured)")
	}
	due, err := s.referrals.DueRewards(ctx, s.now())
	if err != nil {
		return RewardRun{}, err
	}
	var run RewardRun
	for _, r := range due {
		outcome, err := s.settle(ctx, r)
		switch {
		case err != nil:
			run.Retry++
			run.Errors = append(run.Errors, fmt.Errorf("referral of %s: %w", r.InviteeID, err))
		case outcome == StatusRewarded:
			run.Rewarded++
			s.observeReward("rewarded")
		case outcome == StatusForfeited:
			run.Forfeited++
			s.observeReward("forfeited")
		}
	}
	return run, nil
}

func (s *Service) settle(ctx context.Context, r Referral) (Status, error) {
	pi := r.FirstPayment.PaymentIntentID
	if pi == "" {
		if r.FirstPayment.InvoiceID == "" {
			return "", errors.New("first payment has neither a payment intent nor an invoice")
		}
		var err error
		pi, err = s.payments.InvoicePaymentIntent(ctx, r.FirstPayment.InvoiceID)
		if err != nil {
			return "", fmt.Errorf("look up the payment intent of invoice %s: %w", r.FirstPayment.InvoiceID, err)
		}
		if pi == "" {
			return "", fmt.Errorf("invoice %s has no payment intent yet", r.FirstPayment.InvoiceID)
		}
		if err := s.referrals.SetPaymentIntent(ctx, r.InviteeID, pi); err != nil {
			return "", err
		}
	}

	charge, err := s.payments.Charge(ctx, pi)
	if err != nil {
		return "", fmt.Errorf("check payment %s: %w", pi, err)
	}
	if charge.Refunded || charge.Disputed {
		reason := "refunded"
		if charge.Disputed {
			reason = "disputed"
		}
		return StatusForfeited, s.referrals.MarkForfeited(ctx, r.InviteeID, reason, s.now())
	}

	if err := s.credits.GrantReferrerReward(ctx, r.ReferrerID, r.RewardAmount, "referral-reward:"+r.InviteeID); err != nil {
		return "", err
	}
	return StatusRewarded, s.referrals.MarkRewarded(ctx, r.InviteeID, s.now())
}

// PendingReward is a reward waiting for its due date.
type PendingReward struct {
	Amount int64
	DueAt  time.Time
}

// Summary is the referrer's view of their invites.
type Summary struct {
	Code        string
	Invited     int
	Paid        int
	Pending     []PendingReward
	TotalEarned int64
}

// Me returns userID's invite code (created on first use) and how their
// invites are doing.
func (s *Service) Me(ctx context.Context, userID string) (Summary, error) {
	code, err := s.Code(ctx, userID)
	if err != nil {
		return Summary{}, err
	}
	rows, err := s.referrals.ByReferrer(ctx, userID)
	if err != nil {
		return Summary{}, err
	}
	sum := Summary{Code: code, Invited: len(rows), Pending: []PendingReward{}}
	for _, r := range rows {
		if r.FirstPayment != nil {
			sum.Paid++
		}
		switch r.Status {
		case StatusPending:
			sum.Pending = append(sum.Pending, PendingReward{Amount: r.RewardAmount, DueAt: r.RewardDueAt})
		case StatusRewarded:
			sum.TotalEarned += r.RewardAmount
		}
	}
	sort.Slice(sum.Pending, func(i, j int) bool { return sum.Pending[i].DueAt.Before(sum.Pending[j].DueAt) })
	return sum, nil
}

func (s *Service) observeClaim(result string) {
	if s.observer != nil {
		s.observer.ObserveReferralClaim(result)
	}
}

func (s *Service) observeReward(result string) {
	if s.observer != nil {
		s.observer.ObserveReferralReward(result)
	}
}
