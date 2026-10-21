package referral

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"
)

// In-memory stand-ins for the service's seams.

type fakeCodes struct {
	byUser map[string]string
}

func newFakeCodes() *fakeCodes { return &fakeCodes{byUser: map[string]string{}} }

func (f *fakeCodes) CodeOf(_ context.Context, userID string) (string, bool, error) {
	c, ok := f.byUser[userID]
	return c, ok, nil
}

func (f *fakeCodes) OwnerOf(_ context.Context, code string) (string, bool, error) {
	for u, c := range f.byUser {
		if c == code {
			return u, true, nil
		}
	}
	return "", false, nil
}

func (f *fakeCodes) Insert(_ context.Context, userID, code string, _ time.Time) (bool, error) {
	if _, ok := f.byUser[userID]; ok {
		return false, nil
	}
	for _, c := range f.byUser {
		if c == code {
			return false, nil
		}
	}
	f.byUser[userID] = code
	return true, nil
}

type fakeReferrals struct {
	rows      map[string]Referral
	insertErr error
}

func newFakeReferrals() *fakeReferrals { return &fakeReferrals{rows: map[string]Referral{}} }

func (f *fakeReferrals) Get(_ context.Context, inviteeID string) (Referral, bool, error) {
	r, ok := f.rows[inviteeID]
	return r, ok, nil
}

func (f *fakeReferrals) Insert(_ context.Context, r Referral) (bool, error) {
	if f.insertErr != nil {
		return false, f.insertErr
	}
	if _, ok := f.rows[r.InviteeID]; ok {
		return false, nil
	}
	f.rows[r.InviteeID] = r
	return true, nil
}

func (f *fakeReferrals) ByReferrer(_ context.Context, referrerID string) ([]Referral, error) {
	var out []Referral
	for _, r := range f.rows {
		if r.ReferrerID == referrerID {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].InviteeID < out[j].InviteeID })
	return out, nil
}

func (f *fakeReferrals) RecordFirstPayment(_ context.Context, inviteeID string, p FirstPayment, reward Reward) (bool, error) {
	r, ok := f.rows[inviteeID]
	if !ok || r.FirstPayment != nil {
		return false, nil
	}
	r.FirstPayment = &p
	r.Status, r.RewardAmount, r.RewardDueAt = reward.Status, reward.Amount, reward.DueAt
	f.rows[inviteeID] = r
	return true, nil
}

func (f *fakeReferrals) DueRewards(_ context.Context, at time.Time) ([]Referral, error) {
	var out []Referral
	for _, r := range f.rows {
		if r.Status == StatusPending && !r.RewardDueAt.After(at) {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].InviteeID < out[j].InviteeID })
	return out, nil
}

func (f *fakeReferrals) SetPaymentIntent(_ context.Context, inviteeID, paymentIntentID string) error {
	r := f.rows[inviteeID]
	r.FirstPayment.PaymentIntentID = paymentIntentID
	f.rows[inviteeID] = r
	return nil
}

func (f *fakeReferrals) MarkRewarded(_ context.Context, inviteeID string, at time.Time) error {
	r := f.rows[inviteeID]
	r.Status, r.RewardedAt = StatusRewarded, at
	f.rows[inviteeID] = r
	return nil
}

func (f *fakeReferrals) MarkForfeited(_ context.Context, inviteeID, reason string, _ time.Time) error {
	r := f.rows[inviteeID]
	r.Status, r.ForfeitReason = StatusForfeited, reason
	f.rows[inviteeID] = r
	return nil
}

type fakeAccounts struct {
	created        map[string]time.Time
	paid           map[string]bool
	trialElsewhere map[string]bool
}

func newFakeAccounts() *fakeAccounts {
	return &fakeAccounts{created: map[string]time.Time{}, paid: map[string]bool{}, trialElsewhere: map[string]bool{}}
}

func (f *fakeAccounts) TrialUsedByAnotherAccount(_ context.Context, userID string) (bool, error) {
	return f.trialElsewhere[userID], nil
}

func (f *fakeAccounts) CreatedAt(_ context.Context, userID string) (time.Time, error) {
	at, ok := f.created[userID]
	if !ok {
		return time.Time{}, fmt.Errorf("no user %s", userID)
	}
	return at, nil
}

func (f *fakeAccounts) HasPaid(_ context.Context, userID string) (bool, error) {
	return f.paid[userID], nil
}

type bonusCall struct {
	InviteeID string
	Bonus     Bonus
}

type rewardCall struct {
	ReferrerID string
	Amount     int64
	Key        string
}

// fakeCredits records grants and, like the real ledger, applies each
// idempotency key once.
type fakeCredits struct {
	bonuses    []bonusCall
	rewards    []rewardCall
	keys       map[string]bool
	rewardFail bool
}

func newFakeCredits() *fakeCredits { return &fakeCredits{keys: map[string]bool{}} }

func (f *fakeCredits) GrantInviteeBonus(_ context.Context, inviteeID string, b Bonus) (time.Time, error) {
	key := "referral-bonus:" + inviteeID
	if !f.keys[key] {
		f.keys[key] = true
		f.bonuses = append(f.bonuses, bonusCall{inviteeID, b})
	}
	return b.ExpiresAt, nil
}

func (f *fakeCredits) GrantReferrerReward(_ context.Context, referrerID string, amount int64, key string) error {
	if f.rewardFail {
		return errors.New("ledger down")
	}
	if !f.keys[key] {
		f.keys[key] = true
		f.rewards = append(f.rewards, rewardCall{referrerID, amount, key})
	}
	return nil
}

// fakePayments answers from maps; a payment intent or invoice missing from
// them is a Stripe error.
type fakePayments struct {
	invoices map[string]string
	charges  map[string]ChargeState
}

func (f *fakePayments) InvoicePaymentIntent(_ context.Context, invoiceID string) (string, error) {
	pi, ok := f.invoices[invoiceID]
	if !ok {
		return "", errors.New("stripe: no such invoice")
	}
	return pi, nil
}

func (f *fakePayments) Charge(_ context.Context, paymentIntentID string) (ChargeState, error) {
	c, ok := f.charges[paymentIntentID]
	if !ok {
		return ChargeState{}, errors.New("stripe: unavailable")
	}
	return c, nil
}

type recordingObserver struct {
	claims  []string
	rewards []string
}

func (o *recordingObserver) ObserveReferralClaim(result string) { o.claims = append(o.claims, result) }
func (o *recordingObserver) ObserveReferralReward(result string) {
	o.rewards = append(o.rewards, result)
}
