package referral

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)

const day = 24 * time.Hour

// mutablePolicy lets a test change the configured terms mid-way.
type mutablePolicy struct{ terms *Terms }

func (p mutablePolicy) Terms() Terms { return *p.terms }

type harness struct {
	codes     *fakeCodes
	referrals *fakeReferrals
	accounts  *fakeAccounts
	credits   *fakeCredits
	payments  *fakePayments
	observer  *recordingObserver
	terms     Terms
	now       time.Time
	svc       *Service
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{
		codes:     newFakeCodes(),
		referrals: newFakeReferrals(),
		accounts:  newFakeAccounts(),
		credits:   newFakeCredits(),
		payments:  &fakePayments{invoices: map[string]string{}, charges: map[string]ChargeState{}},
		observer:  &recordingObserver{},
		terms: Terms{
			TrialAmount:                100,
			TrialTTL:                   7 * day,
			InviteeBonus:               100,
			InviteeTTL:                 14 * day,
			ReferrerRewardSubscription: 300,
			ReferrerRewardTopupPercent: 20,
			RewardDelay:                14 * day,
			ClaimWindow:                24 * time.Hour,
		},
		now: t0,
	}
	h.svc = NewService(h.codes, h.referrals, h.accounts, h.credits, h.payments,
		func() time.Time { return h.now }, mutablePolicy{&h.terms}).WithObserver(h.observer)
	return h
}

// referrer gives userID an account and an invite code.
func (h *harness) referrer(t *testing.T, userID string) string {
	t.Helper()
	h.accounts.created[userID] = t0.Add(-30 * day)
	code, err := h.svc.Code(context.Background(), userID)
	if err != nil {
		t.Fatalf("Code: %v", err)
	}
	return code
}

// invitee signs userID up at t0.
func (h *harness) invitee(userID string) { h.accounts.created[userID] = t0 }

// claimed has invitee claim referrer's code at t0.
func (h *harness) claimed(t *testing.T, referrerID, inviteeID string) {
	t.Helper()
	code := h.referrer(t, referrerID)
	h.invitee(inviteeID)
	if _, err := h.svc.Claim(context.Background(), inviteeID, code); err != nil {
		t.Fatalf("Claim: %v", err)
	}
}

func claimReason(err error) Reason {
	var ce *ClaimError
	if errors.As(err, &ce) {
		return ce.Reason
	}
	return ""
}

// --- invite codes ---

func TestCodeIsCreatedOnceAndKept(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	first, err := h.svc.Code(ctx, "alice")
	if err != nil {
		t.Fatalf("Code: %v", err)
	}
	if !regexp.MustCompile(`^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$`).MatchString(first) {
		t.Fatalf("code %q is not 8 unambiguous base32 characters", first)
	}
	again, _ := h.svc.Code(ctx, "alice")
	if again != first {
		t.Fatalf("second Code = %q, want the same %q", again, first)
	}
}

func TestCodeRetriesWhenTheRandomCodeIsTaken(t *testing.T) {
	h := newHarness(t)
	h.codes.byUser["bob"] = "AAAAAAAA"
	codes := []string{"AAAAAAAA", "BBBBBBBB"}
	h.svc.newCode = func() string { c := codes[0]; codes = codes[1:]; return c }

	got, err := h.svc.Code(context.Background(), "alice")
	if err != nil || got != "BBBBBBBB" {
		t.Fatalf("Code = %q, %v; want BBBBBBBB after a collision", got, err)
	}
}

// --- claiming ---

func TestClaimWithinTheWindowGrantsTheBonusAndRecordsTheReferral(t *testing.T) {
	h := newHarness(t)
	code := h.referrer(t, "alice")
	h.invitee("bob")
	h.now = t0.Add(23 * time.Hour)

	res, err := h.svc.Claim(context.Background(), "bob", code)
	if err != nil {
		t.Fatalf("Claim: %v", err)
	}
	wantExpiry := t0.Add(14 * day)
	if res.Bonus != 100 || !res.TrialExpiresAt.Equal(wantExpiry) {
		t.Fatalf("result = %+v, want bonus 100 expiring %v", res, wantExpiry)
	}
	if len(h.credits.bonuses) != 1 {
		t.Fatalf("bonus grants = %d, want 1", len(h.credits.bonuses))
	}
	got := h.credits.bonuses[0]
	want := Bonus{Amount: 100, ExpiresAt: wantExpiry, TrialAmount: 100, TrialTTL: 7 * day}
	if got.InviteeID != "bob" || got.Bonus != want {
		t.Fatalf("bonus grant = %+v, want bob %+v (sign-up + invitee TTL, trial terms for a backfill)", got, want)
	}
	r, ok := h.referrals.rows["bob"]
	if !ok || r.ReferrerID != "alice" || r.Code != code || r.Status != StatusClaimed {
		t.Fatalf("referral = %+v, %v; want bob claimed alice's code", r, ok)
	}
	if len(h.observer.claims) != 1 || h.observer.claims[0] != "ok" {
		t.Fatalf("claim metrics = %v, want [ok]", h.observer.claims)
	}
}

func TestClaimAcceptsTheCodeInAnyCaseWithSpaces(t *testing.T) {
	h := newHarness(t)
	code := h.referrer(t, "alice")
	h.invitee("bob")

	if _, err := h.svc.Claim(context.Background(), "bob", "  "+strings.ToLower(code)+" "); err != nil {
		t.Fatalf("Claim: %v", err)
	}
}

func TestClaimRefusals(t *testing.T) {
	cases := []struct {
		name  string
		setup func(h *harness, code string) (invitee, claimCode string)
		want  Reason
	}{
		{
			name: "outside the claim window",
			setup: func(h *harness, code string) (string, string) {
				h.invitee("bob")
				h.now = t0.Add(24 * time.Hour)
				return "bob", code
			},
			want: ReasonClaimWindowClosed,
		},
		{
			name: "already claimed",
			setup: func(h *harness, code string) (string, string) {
				h.invitee("bob")
				h.referrals.rows["bob"] = Referral{InviteeID: "bob", ReferrerID: "carol", Status: StatusClaimed}
				return "bob", code
			},
			want: ReasonAlreadyClaimed,
		},
		{
			name: "unknown code",
			setup: func(h *harness, _ string) (string, string) {
				h.invitee("bob")
				return "bob", "ZZZZZZZZ"
			},
			want: ReasonCodeNotFound,
		},
		{
			name: "malformed code",
			setup: func(h *harness, _ string) (string, string) {
				h.invitee("bob")
				return "bob", "not a code!"
			},
			want: ReasonCodeNotFound,
		},
		{
			name: "own code",
			setup: func(h *harness, code string) (string, string) {
				h.accounts.created["alice"] = t0
				return "alice", code
			},
			want: ReasonOwnCode,
		},
		{
			name: "already paid",
			setup: func(h *harness, code string) (string, string) {
				h.invitee("bob")
				h.accounts.paid["bob"] = true
				return "bob", code
			},
			want: ReasonAlreadyPaid,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := newHarness(t)
			code := h.referrer(t, "alice")
			invitee, claimCode := c.setup(h, code)
			before := len(h.referrals.rows)

			res, err := h.svc.Claim(context.Background(), invitee, claimCode)
			if got := claimReason(err); got != c.want {
				t.Fatalf("Claim error = %v (reason %q), want reason %q", err, got, c.want)
			}
			if res.Bonus != 0 || len(h.credits.bonuses) != 0 {
				t.Fatalf("result %+v, bonus grants %d; want nothing granted", res, len(h.credits.bonuses))
			}
			if len(h.referrals.rows) != before {
				t.Fatalf("referrals = %d, want %d (nothing recorded)", len(h.referrals.rows), before)
			}
			if len(h.observer.claims) != 1 || h.observer.claims[0] != string(c.want) {
				t.Fatalf("claim metrics = %v, want [%s]", h.observer.claims, c.want)
			}
		})
	}
}

func TestClaimWithTheBonusOffStillRecordsTheReferral(t *testing.T) {
	h := newHarness(t)
	h.terms.InviteeBonus = 0
	code := h.referrer(t, "alice")
	h.invitee("bob")

	res, err := h.svc.Claim(context.Background(), "bob", code)
	if err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if res.Bonus != 0 || !res.TrialExpiresAt.IsZero() || len(h.credits.bonuses) != 0 {
		t.Fatalf("result %+v, grants %d; want no credits", res, len(h.credits.bonuses))
	}
	if _, ok := h.referrals.rows["bob"]; !ok {
		t.Fatal("referral not recorded with the bonus off")
	}
}

func TestOneCodeServesAnyNumberOfInvitees(t *testing.T) {
	h := newHarness(t)
	code := h.referrer(t, "alice")
	for _, u := range []string{"bob", "carol", "dave"} {
		h.invitee(u)
		if _, err := h.svc.Claim(context.Background(), u, code); err != nil {
			t.Fatalf("Claim(%s): %v", u, err)
		}
	}
	if len(h.referrals.rows) != 3 {
		t.Fatalf("referrals = %d, want 3", len(h.referrals.rows))
	}
}

// --- the landing page offer ---

func TestOfferAddsTheBonusToTheTrial(t *testing.T) {
	h := newHarness(t)
	if got := h.svc.Offer(); got != (Offer{Credits: 200, Days: 14}) {
		t.Fatalf("Offer = %+v, want 200 credits / 14 days", got)
	}
	h.terms.InviteeBonus, h.terms.InviteeTTL = 50, 10*day
	if got := h.svc.Offer(); got != (Offer{Credits: 150, Days: 10}) {
		t.Fatalf("Offer after a config change = %+v, want 150 / 10", got)
	}
}

func TestOfferWithTheBonusOffFallsBackToTheTrial(t *testing.T) {
	h := newHarness(t)
	h.terms.InviteeBonus = 0
	if got := h.svc.Offer(); got != (Offer{Credits: 100, Days: 7}) {
		t.Fatalf("Offer = %+v, want the trial's 100 credits / 7 days", got)
	}
}

// --- an email that already had a trial (ADR-062 Decision 3) ---

func TestClaimByAReRegisteredEmailLinksTheReferralButGrantsNoBonus(t *testing.T) {
	h := newHarness(t)
	code := h.referrer(t, "alice")
	h.invitee("bob")
	h.accounts.trialElsewhere["bob"] = true

	res, err := h.svc.Claim(context.Background(), "bob", code)
	if err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if res.Bonus != 0 || len(h.credits.bonuses) != 0 {
		t.Fatalf("result = %+v, bonus grants = %d; want no bonus", res, len(h.credits.bonuses))
	}
	r, ok := h.referrals.rows["bob"]
	if !ok || r.ReferrerID != "alice" || !r.RewardsBlocked {
		t.Fatalf("referral = %+v (stored %v), want alice's with rewards blocked", r, ok)
	}
}

func TestFirstPaymentOfABlockedReferralQueuesNoReferrerReward(t *testing.T) {
	h := newHarness(t)
	code := h.referrer(t, "alice")
	h.invitee("bob")
	h.accounts.trialElsewhere["bob"] = true
	if _, err := h.svc.Claim(context.Background(), "bob", code); err != nil {
		t.Fatalf("Claim: %v", err)
	}

	if err := h.svc.RecordFirstPayment(context.Background(), "bob", FirstPayment{
		Kind: KindSubscription, InvoiceID: "in_1", Credits: 500, PaidAt: t0,
	}); err != nil {
		t.Fatalf("RecordFirstPayment: %v", err)
	}
	if r := h.referrals.rows["bob"]; r.Status != StatusNoReward || r.RewardAmount != 0 || r.FirstPayment == nil {
		t.Fatalf("referral = %+v, want the payment recorded as no_reward", r)
	}
}

// --- recording the first payment ---

func TestRecordFirstPaymentForASubscription(t *testing.T) {
	h := newHarness(t)
	h.claimed(t, "alice", "bob")
	paid := t0.Add(2 * day)

	err := h.svc.RecordFirstPayment(context.Background(), "bob", FirstPayment{
		Kind: KindSubscription, InvoiceID: "in_1", Credits: 500, PaidAt: paid,
	})
	if err != nil {
		t.Fatalf("RecordFirstPayment: %v", err)
	}
	r := h.referrals.rows["bob"]
	if r.FirstPayment == nil || r.FirstPayment.InvoiceID != "in_1" || r.FirstPayment.Kind != KindSubscription {
		t.Fatalf("first payment = %+v, want the subscription invoice", r.FirstPayment)
	}
	if r.Status != StatusPending || r.RewardAmount != 300 || !r.RewardDueAt.Equal(paid.Add(14*day)) {
		t.Fatalf("reward = %s %d due %v, want pending 300 due %v", r.Status, r.RewardAmount, r.RewardDueAt, paid.Add(14*day))
	}
}

func TestRecordFirstPaymentForATopupRewardsAPercentRoundedDown(t *testing.T) {
	for _, c := range []struct{ credits, want int64 }{{300, 60}, {333, 66}} {
		h := newHarness(t)
		h.claimed(t, "alice", "bob")
		if err := h.svc.RecordFirstPayment(context.Background(), "bob", FirstPayment{
			Kind: KindTopup, PaymentIntentID: "pi_1", Credits: c.credits, PaidAt: t0,
		}); err != nil {
			t.Fatalf("RecordFirstPayment: %v", err)
		}
		if got := h.referrals.rows["bob"].RewardAmount; got != c.want {
			t.Errorf("reward for a %d-credit top-up = %d, want %d", c.credits, got, c.want)
		}
	}
}

func TestRecordFirstPaymentUsesTheClockWhenThePaymentHasNoTime(t *testing.T) {
	h := newHarness(t)
	h.claimed(t, "alice", "bob")
	h.now = t0.Add(3 * day)
	if err := h.svc.RecordFirstPayment(context.Background(), "bob", FirstPayment{Kind: KindTopup, PaymentIntentID: "pi_1", Credits: 300}); err != nil {
		t.Fatalf("RecordFirstPayment: %v", err)
	}
	if got, want := h.referrals.rows["bob"].RewardDueAt, h.now.Add(14*day); !got.Equal(want) {
		t.Fatalf("due = %v, want %v", got, want)
	}
}

func TestLaterPaymentsAreNoOps(t *testing.T) {
	h := newHarness(t)
	h.claimed(t, "alice", "bob")
	ctx := context.Background()
	first := FirstPayment{Kind: KindTopup, PaymentIntentID: "pi_1", Credits: 300, PaidAt: t0}
	if err := h.svc.RecordFirstPayment(ctx, "bob", first); err != nil {
		t.Fatalf("RecordFirstPayment: %v", err)
	}
	// A renewal, and a replay of the same event.
	for _, p := range []FirstPayment{
		{Kind: KindSubscription, InvoiceID: "in_2", Credits: 500, PaidAt: t0.Add(30 * day)},
		first,
	} {
		if err := h.svc.RecordFirstPayment(ctx, "bob", p); err != nil {
			t.Fatalf("RecordFirstPayment: %v", err)
		}
	}
	r := h.referrals.rows["bob"]
	if r.FirstPayment.PaymentIntentID != "pi_1" || r.RewardAmount != 60 {
		t.Fatalf("referral = %+v, want the first top-up kept", r)
	}
}

func TestAPaymentWithoutAReferralChangesNothing(t *testing.T) {
	h := newHarness(t)
	if err := h.svc.RecordFirstPayment(context.Background(), "stranger", FirstPayment{Kind: KindTopup, PaymentIntentID: "pi_1", Credits: 300}); err != nil {
		t.Fatalf("RecordFirstPayment: %v", err)
	}
	if len(h.referrals.rows) != 0 {
		t.Fatalf("referrals = %v, want none", h.referrals.rows)
	}
}

func TestRewardOffRecordsThePaymentWithoutAReward(t *testing.T) {
	h := newHarness(t)
	h.terms.ReferrerRewardSubscription = 0
	h.claimed(t, "alice", "bob")
	if err := h.svc.RecordFirstPayment(context.Background(), "bob", FirstPayment{Kind: KindSubscription, InvoiceID: "in_1", Credits: 500, PaidAt: t0}); err != nil {
		t.Fatalf("RecordFirstPayment: %v", err)
	}
	r := h.referrals.rows["bob"]
	if r.Status != StatusNoReward || r.RewardAmount != 0 {
		t.Fatalf("referral = %+v, want no reward recorded", r)
	}
	h.now = t0.Add(30 * day)
	if _, err := h.svc.PayDueRewards(context.Background()); err != nil {
		t.Fatalf("PayDueRewards: %v", err)
	}
	if len(h.credits.rewards) != 0 {
		t.Fatalf("rewards = %+v, want none", h.credits.rewards)
	}
}

func TestRecordFirstPaymentRejectsAnUnknownKind(t *testing.T) {
	h := newHarness(t)
	h.claimed(t, "alice", "bob")
	if err := h.svc.RecordFirstPayment(context.Background(), "bob", FirstPayment{Kind: "gift"}); err == nil {
		t.Fatal("RecordFirstPayment accepted an unknown kind")
	}
}

// --- paying due rewards ---

// paidTopup has bob, invited by alice, buy a 300-credit top-up at t0.
func paidTopup(t *testing.T, h *harness) {
	t.Helper()
	h.claimed(t, "alice", "bob")
	if err := h.svc.RecordFirstPayment(context.Background(), "bob", FirstPayment{
		Kind: KindTopup, PaymentIntentID: "pi_bob", Credits: 300, PaidAt: t0,
	}); err != nil {
		t.Fatalf("RecordFirstPayment: %v", err)
	}
}

func TestNoRewardBeforeItIsDue(t *testing.T) {
	h := newHarness(t)
	paidTopup(t, h)
	h.payments.charges["pi_bob"] = ChargeState{}
	h.now = t0.Add(14*day - time.Second)

	if _, err := h.svc.PayDueRewards(context.Background()); err != nil {
		t.Fatalf("PayDueRewards: %v", err)
	}
	if len(h.credits.rewards) != 0 || h.referrals.rows["bob"].Status != StatusPending {
		t.Fatalf("rewards %+v, status %s; want nothing yet", h.credits.rewards, h.referrals.rows["bob"].Status)
	}
}

func TestADueCleanPaymentRewardsTheReferrer(t *testing.T) {
	h := newHarness(t)
	paidTopup(t, h)
	h.payments.charges["pi_bob"] = ChargeState{}
	h.now = t0.Add(14 * day)

	run, err := h.svc.PayDueRewards(context.Background())
	if err != nil {
		t.Fatalf("PayDueRewards: %v", err)
	}
	want := []rewardCall{{"alice", 60, "referral-reward:bob"}}
	if len(h.credits.rewards) != 1 || h.credits.rewards[0] != want[0] {
		t.Fatalf("rewards = %+v, want %+v", h.credits.rewards, want)
	}
	r := h.referrals.rows["bob"]
	if r.Status != StatusRewarded || !r.RewardedAt.Equal(h.now) {
		t.Fatalf("referral = %+v, want rewarded now", r)
	}
	if run.Rewarded != 1 || len(h.observer.rewards) != 1 || h.observer.rewards[0] != "rewarded" {
		t.Fatalf("run %+v, reward metrics %v; want one rewarded", run, h.observer.rewards)
	}
}

func TestARefundOrDisputeForfeitsTheReward(t *testing.T) {
	for name, state := range map[string]ChargeState{
		"refunded": {Refunded: true},
		"disputed": {Disputed: true},
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			paidTopup(t, h)
			h.payments.charges["pi_bob"] = state
			h.now = t0.Add(15 * day)

			run, err := h.svc.PayDueRewards(context.Background())
			if err != nil {
				t.Fatalf("PayDueRewards: %v", err)
			}
			r := h.referrals.rows["bob"]
			if r.Status != StatusForfeited || r.ForfeitReason != name || len(h.credits.rewards) != 0 {
				t.Fatalf("referral %+v, rewards %+v; want forfeited (%s), nothing granted", r, h.credits.rewards, name)
			}
			if run.Forfeited != 1 || len(h.observer.rewards) != 1 || h.observer.rewards[0] != "forfeited" {
				t.Fatalf("run %+v, metrics %v; want one forfeited", run, h.observer.rewards)
			}
		})
	}
}

// paidSubscriptionWithoutIntent has bob's first payment be a subscription
// whose payment intent the webhook could not look up.
func paidSubscriptionWithoutIntent(t *testing.T, h *harness) {
	t.Helper()
	h.claimed(t, "alice", "bob")
	if err := h.svc.RecordFirstPayment(context.Background(), "bob", FirstPayment{
		Kind: KindSubscription, InvoiceID: "in_bob", Credits: 500, PaidAt: t0,
	}); err != nil {
		t.Fatalf("RecordFirstPayment: %v", err)
	}
	h.now = t0.Add(14 * day)
}

func TestAMissingPaymentIntentIsRecoveredFromTheInvoice(t *testing.T) {
	h := newHarness(t)
	paidSubscriptionWithoutIntent(t, h)
	h.payments.invoices["in_bob"] = "pi_bob"
	h.payments.charges["pi_bob"] = ChargeState{}

	if _, err := h.svc.PayDueRewards(context.Background()); err != nil {
		t.Fatalf("PayDueRewards: %v", err)
	}
	r := h.referrals.rows["bob"]
	if r.FirstPayment.PaymentIntentID != "pi_bob" || r.Status != StatusRewarded || h.credits.rewards[0].Amount != 300 {
		t.Fatalf("referral %+v, rewards %+v; want the intent stored and 300 rewarded", r, h.credits.rewards)
	}
}

func TestRowsStayPendingWhenStripeCannotAnswer(t *testing.T) {
	cases := map[string]func(h *harness){
		"invoice lookup fails":  func(h *harness) {},
		"invoice has no intent": func(h *harness) { h.payments.invoices["in_bob"] = "" },
		"charge lookup fails":   func(h *harness) { h.payments.invoices["in_bob"] = "pi_bob" },
		"reward grant fails": func(h *harness) {
			h.payments.invoices["in_bob"] = "pi_bob"
			h.payments.charges["pi_bob"] = ChargeState{}
			h.credits.rewardFail = true
		},
	}
	for name, setup := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			paidSubscriptionWithoutIntent(t, h)
			setup(h)

			run, err := h.svc.PayDueRewards(context.Background())
			if err != nil {
				t.Fatalf("PayDueRewards: %v", err)
			}
			if r := h.referrals.rows["bob"]; r.Status != StatusPending {
				t.Fatalf("status = %s, want pending for a retry next hour", r.Status)
			}
			if run.Retry != 1 || len(run.Errors) != 1 {
				t.Fatalf("run = %+v, want one row to retry with its error", run)
			}
		})
	}
}

func TestRerunningTheJobDoesNotPayTwice(t *testing.T) {
	h := newHarness(t)
	paidTopup(t, h)
	h.payments.charges["pi_bob"] = ChargeState{}
	h.now = t0.Add(14 * day)
	ctx := context.Background()

	for range 2 {
		if _, err := h.svc.PayDueRewards(ctx); err != nil {
			t.Fatalf("PayDueRewards: %v", err)
		}
	}
	if len(h.credits.rewards) != 1 {
		t.Fatalf("rewards = %+v, want one", h.credits.rewards)
	}
}

func TestAConfigChangeKeepsTheRecordedReward(t *testing.T) {
	h := newHarness(t)
	paidTopup(t, h)
	h.terms.ReferrerRewardTopupPercent = 50
	h.payments.charges["pi_bob"] = ChargeState{}
	h.now = t0.Add(14 * day)

	if _, err := h.svc.PayDueRewards(context.Background()); err != nil {
		t.Fatalf("PayDueRewards: %v", err)
	}
	if h.credits.rewards[0].Amount != 60 {
		t.Fatalf("reward = %d, want the recorded 60", h.credits.rewards[0].Amount)
	}
}

// --- the referrer's summary ---

func TestMeSummarizesInvitesPaymentsAndRewards(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	code := h.referrer(t, "alice")
	for _, u := range []string{"bob", "carol", "dave"} {
		h.invitee(u)
		if _, err := h.svc.Claim(ctx, u, code); err != nil {
			t.Fatalf("Claim(%s): %v", u, err)
		}
	}
	// bob's reward was paid, carol's is pending, dave never paid.
	_ = h.svc.RecordFirstPayment(ctx, "bob", FirstPayment{Kind: KindTopup, PaymentIntentID: "pi_bob", Credits: 300, PaidAt: t0})
	h.payments.charges["pi_bob"] = ChargeState{}
	h.now = t0.Add(14 * day)
	if _, err := h.svc.PayDueRewards(ctx); err != nil {
		t.Fatalf("PayDueRewards: %v", err)
	}
	_ = h.svc.RecordFirstPayment(ctx, "carol", FirstPayment{Kind: KindSubscription, InvoiceID: "in_c", Credits: 500, PaidAt: h.now})

	got, err := h.svc.Me(ctx, "alice")
	if err != nil {
		t.Fatalf("Me: %v", err)
	}
	if got.Code != code || got.Invited != 3 || got.Paid != 2 || got.TotalEarned != 60 {
		t.Fatalf("summary = %+v, want code %s, 3 invited, 2 paid, 60 earned", got, code)
	}
	if len(got.Pending) != 1 || got.Pending[0].Amount != 300 || !got.Pending[0].DueAt.Equal(h.now.Add(14*day)) {
		t.Fatalf("pending = %+v, want carol's 300 due in 14 days", got.Pending)
	}
}

func TestMeForANewUserCreatesTheCode(t *testing.T) {
	h := newHarness(t)
	got, err := h.svc.Me(context.Background(), "alice")
	if err != nil {
		t.Fatalf("Me: %v", err)
	}
	if got.Code == "" || got.Invited != 0 || got.Pending == nil {
		t.Fatalf("summary = %+v, want a code, zero counts and an empty pending list", got)
	}
}
