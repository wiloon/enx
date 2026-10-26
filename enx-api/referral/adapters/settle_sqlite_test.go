//go:build integration

package adapters

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"enx-api/billing/credit"
	"enx-api/referral"
	"enx-api/repo"
	"enx-api/utils/sqlitex"
)

// Paying a reward races the referrer's account deletion (ADR-051 Decision 5,
// ADR-062 Decision 1). These run the service over the real repositories and
// ledger on a database file opened like production (WAL, BEGIN IMMEDIATE),
// so the grant and the deletion are real transactions.

var settleAt = time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)

func newFileDB(t *testing.T) {
	t.Helper()
	prev := sqlitex.DB
	if err := sqlitex.InitWithLogLevel(filepath.Join(t.TempDir(), "enx.db"), "warn"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlitex.DB = prev })
}

// cleanCharge is a Stripe that reports every payment clean, after running
// onCharge: the point between the service's existence check and the grant.
type cleanCharge struct{ onCharge func() }

func (cleanCharge) InvoicePaymentIntent(context.Context, string) (string, error) {
	return "", errors.New("not used: the payment has an intent")
}

func (c cleanCharge) Charge(context.Context, string) (referral.ChargeState, error) {
	if c.onCharge != nil {
		c.onCharge()
	}
	return referral.ChargeState{}, nil
}

// seedDueReward: bob, invited by alice, paid a top-up whose 60-credit reward
// is due at settleAt.
func seedDueReward(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	for _, id := range []string{"alice", "bob"} {
		if err := sqlitex.DB.Create(&sqlitex.User{
			Id: id, ClerkUserID: "user_" + id, Name: id, Status: "active", CreatedAt: settleAt.Add(-60 * 24 * time.Hour),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	refs := repo.Referrals{}
	if _, err := refs.Insert(ctx, referral.Referral{
		InviteeID: "bob", ReferrerID: "alice", Code: "AAAAAAAA", ClaimedAt: settleAt.Add(-30 * 24 * time.Hour), Status: referral.StatusClaimed,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := refs.RecordFirstPayment(ctx, "bob", referral.FirstPayment{
		Kind: referral.KindTopup, PaymentIntentID: "pi_bob", Credits: 300, PaidAt: settleAt.Add(-15 * 24 * time.Hour),
	}, referral.Reward{Status: referral.StatusPending, Amount: 60, DueAt: settleAt.Add(-24 * time.Hour)}); err != nil {
		t.Fatal(err)
	}
}

func payDueRewards(t *testing.T, payments referral.PaymentChecker) referral.RewardRun {
	t.Helper()
	svc := referral.NewService(repo.ReferralCodes{}, repo.Referrals{}, repo.ReferralAccounts{}, ledger, payments,
		func() time.Time { return settleAt }, referral.FixedPolicy{})
	run, err := svc.PayDueRewards(context.Background())
	if err != nil {
		t.Fatalf("PayDueRewards: %v", err)
	}
	return run
}

func count(t *testing.T, table, where string, args ...any) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Table(table).Where(where, args...).Count(&n).Error; err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func TestAReferrerDeletedBeforeTheGrantCommitsForfeitsTheReward(t *testing.T) {
	newFileDB(t)
	seedDueReward(t)
	deleteAlice := func() {
		if err := (repo.Accounts{}).DeleteData(context.Background(), "alice"); err != nil {
			t.Errorf("DeleteData: %v", err)
		}
	}

	run := payDueRewards(t, cleanCharge{onCharge: deleteAlice})

	if run.Forfeited != 1 || run.Rewarded != 0 || run.Retry != 0 {
		t.Fatalf("run = %+v, want one forfeited", run)
	}
	r, _, err := (repo.Referrals{}).Get(context.Background(), "bob")
	if err != nil || r.Status != referral.StatusForfeited || r.ForfeitReason != "referrer_deleted" {
		t.Fatalf("referral = %+v, %v; want forfeited (referrer_deleted)", r, err)
	}
	if n := count(t, "credit_accounts", "user_id = ?", "alice"); n != 0 {
		t.Fatalf("alice has %d credit_accounts row(s), want none recreated", n)
	}
	if n := count(t, "credit_transactions", "user_id = ? AND type = ?", "alice", credit.TypeGrantReferralReward); n != 0 {
		t.Fatalf("alice has %d reward ledger row(s), want none", n)
	}
}

func TestAReferrerDeletedAfterTheGrantCommitsLosesTheBalanceButKeepsTheLedger(t *testing.T) {
	newFileDB(t)
	seedDueReward(t)

	if run := payDueRewards(t, cleanCharge{}); run.Rewarded != 1 {
		t.Fatalf("run = %+v, want one rewarded", run)
	}
	if err := (repo.Accounts{}).DeleteData(context.Background(), "alice"); err != nil {
		t.Fatalf("DeleteData: %v", err)
	}

	if n := count(t, "users", "id = ?", "alice"); n != 0 {
		t.Fatalf("alice has %d users row(s), want none", n)
	}
	if n := count(t, "credit_accounts", "user_id = ?", "alice"); n != 0 {
		t.Fatalf("alice has %d credit_accounts row(s), want the balance deleted", n)
	}
	if n := count(t, "credit_transactions", "user_id = ? AND type = ?", "alice", credit.TypeGrantReferralReward); n != 1 {
		t.Fatalf("alice has %d reward ledger row(s), want the committed one kept", n)
	}
}

func TestOverlappingPassCanMarkAGrantedButForfeitedRewardAsRewarded(t *testing.T) {
	newFileDB(t)
	seedDueReward(t)
	ctx := context.Background()
	refs := repo.Referrals{}
	// Both passes read pending before B grants; A then forfeits its stale row.
	for range 2 {
		rows, err := refs.DueRewards(ctx, settleAt, "referral-reward:")
		if err != nil || len(rows) != 1 {
			t.Fatalf("initial due = %+v, %v", rows, err)
		}
	}
	if err := ledger.GrantReferrerReward(ctx, "alice", 60, "referral-reward:bob"); err != nil {
		t.Fatal(err)
	}
	if err := (repo.Accounts{}).DeleteData(ctx, "alice"); err != nil {
		t.Fatal(err)
	}
	if err := refs.MarkForfeited(ctx, "bob", "referrer_deleted", settleAt); err != nil {
		t.Fatal(err)
	}
	r, ok, err := refs.Get(ctx, "bob")
	if err != nil || !ok || r.Status != referral.StatusForfeited {
		t.Fatalf("A forfeits = %+v, %v, %v", r, ok, err)
	}
	if err := refs.MarkRewarded(ctx, "bob", settleAt); err != nil {
		t.Fatal(err)
	}
	r, ok, err = refs.Get(ctx, "bob")
	if err != nil || !ok || r.Status != referral.StatusRewarded || r.ForfeitReason != "" || !r.RewardedAt.Equal(settleAt) {
		t.Fatalf("B settles = %+v, %v, %v", r, ok, err)
	}
	if n := count(t, "credit_transactions", "type = ?", credit.TypeGrantReferralReward); n != 1 {
		t.Fatalf("reward ledger rows = %d", n)
	}
	if n := count(t, "credit_accounts", "user_id = ?", "alice"); n != 0 {
		t.Fatalf("recreated %d balances", n)
	}
}

func TestOverlappingPassIsReconciledOnTheNextRunAfterAStatusWriteFails(t *testing.T) {
	newFileDB(t)
	seedDueReward(t)
	ctx := context.Background()
	refs := repo.Referrals{}
	for range 2 {
		rows, err := refs.DueRewards(ctx, settleAt, "referral-reward:")
		if err != nil || len(rows) != 1 {
			t.Fatalf("initial due = %+v, %v", rows, err)
		}
	}
	if err := ledger.GrantReferrerReward(ctx, "alice", 60, "referral-reward:bob"); err != nil {
		t.Fatal(err)
	}
	if err := (repo.Accounts{}).DeleteData(ctx, "alice"); err != nil {
		t.Fatal(err)
	}
	if err := refs.MarkForfeited(ctx, "bob", "referrer_deleted", settleAt); err != nil {
		t.Fatal(err)
	}
	// B never writes rewarded, as if its status write failed.
	rows, err := refs.DueRewards(ctx, settleAt, "referral-reward:")
	if err != nil || len(rows) != 1 || rows[0].Status != referral.StatusForfeited {
		t.Fatalf("reconciliation due = %+v, %v", rows, err)
	}
	refsWithFailure := &failingRewardWrites{ReferralRepo: refs, fail: true}
	svc := referral.NewService(repo.ReferralCodes{}, refsWithFailure, repo.ReferralAccounts{}, ledger, cleanCharge{}, func() time.Time { return settleAt }, referral.FixedPolicy{})
	failed, err := svc.PayDueRewards(ctx)
	if err != nil || failed.Retry != 1 || len(failed.Errors) != 1 || failed.Rewarded != 0 || failed.Forfeited != 0 {
		t.Fatalf("failed reconciliation = %+v, %v", failed, err)
	}
	stillForfeited, ok, err := refs.Get(ctx, "bob")
	if err != nil || !ok || stillForfeited.Status != referral.StatusForfeited || stillForfeited.ForfeitReason != "referrer_deleted" {
		t.Fatalf("failed reconciliation row = %+v, %v, %v", stillForfeited, ok, err)
	}
	run := payDueRewards(t, cleanCharge{onCharge: func() { t.Error("recovery asked Stripe") }})
	if run.Rewarded != 1 || run.Forfeited != 0 || run.Retry != 0 {
		t.Fatalf("recovery = %+v", run)
	}
	r, ok, err := refs.Get(ctx, "bob")
	if err != nil || !ok || r.Status != referral.StatusRewarded || r.ForfeitReason != "" {
		t.Fatalf("reconciled = %+v, %v, %v", r, ok, err)
	}
	if n := count(t, "credit_transactions", "type = ?", credit.TypeGrantReferralReward); n != 1 {
		t.Fatalf("reward ledger rows = %d", n)
	}
	if n := count(t, "credit_accounts", "user_id = ?", "alice"); n != 0 {
		t.Fatalf("recreated %d balances", n)
	}
}

// failingRewardWrites simulates the independent status write failing after
// the real ledger transaction has committed.
type failingRewardWrites struct {
	referral.ReferralRepo
	fail bool
}

func (r *failingRewardWrites) MarkRewarded(ctx context.Context, id string, at time.Time) error {
	if r.fail {
		return errors.New("status write unavailable")
	}
	return r.ReferralRepo.MarkRewarded(ctx, id, at)
}

type changedCharge struct{ state referral.ChargeState }

func (changedCharge) InvoicePaymentIntent(context.Context, string) (string, error) {
	return "", errors.New("unexpected invoice lookup")
}
func (c changedCharge) Charge(context.Context, string) (referral.ChargeState, error) {
	return c.state, nil
}

func TestCommittedLedgerRewardSurvivesRepeatedStatusWriteFailures(t *testing.T) {
	for _, scenario := range []string{"deleted", "refunded", "disputed"} {
		t.Run(scenario, func(t *testing.T) {
			newFileDB(t)
			seedDueReward(t)
			ctx := context.Background()
			refs := &failingRewardWrites{ReferralRepo: repo.Referrals{}, fail: true}
			svc := referral.NewService(repo.ReferralCodes{}, refs, repo.ReferralAccounts{}, ledger, cleanCharge{}, func() time.Time { return settleAt }, referral.FixedPolicy{})
			run, err := svc.PayDueRewards(ctx)
			if err != nil || run.Retry != 1 || len(run.Errors) != 1 {
				t.Fatalf("first pass = %+v, %v", run, err)
			}
			var state referral.ChargeState
			switch scenario {
			case "deleted":
				if err := (repo.Accounts{}).DeleteData(ctx, "alice"); err != nil {
					t.Fatal(err)
				}
			case "refunded":
				state.Refunded = true
			case "disputed":
				state.Disputed = true
			}
			svc = referral.NewService(repo.ReferralCodes{}, refs, repo.ReferralAccounts{}, ledger, changedCharge{state}, func() time.Time { return settleAt }, referral.FixedPolicy{})
			run, err = svc.PayDueRewards(ctx)
			if err != nil || run.Retry != 1 || len(run.Errors) != 1 || run.Forfeited != 0 || run.Rewarded != 0 {
				t.Fatalf("failed recovery = %+v, %v", run, err)
			}
			r, ok, err := refs.Get(ctx, "bob")
			if err != nil || !ok || r.Status != referral.StatusPending {
				t.Fatalf("failed recovery row = %+v, %v, %v", r, ok, err)
			}
			refs.fail = false
			run, err = svc.PayDueRewards(ctx)
			if err != nil || run.Rewarded != 1 || run.Retry != 0 || run.Forfeited != 0 {
				t.Fatalf("recovery = %+v, %v", run, err)
			}
			r, ok, err = refs.Get(ctx, "bob")
			if err != nil || !ok || r.Status != referral.StatusRewarded {
				t.Fatalf("recovered row = %+v, %v, %v", r, ok, err)
			}
			if n := count(t, "credit_transactions", "type = ?", credit.TypeGrantReferralReward); n != 1 {
				t.Fatalf("reward ledger rows = %d", n)
			}
			if scenario == "deleted" {
				if n := count(t, "credit_accounts", "user_id = ?", "alice"); n != 0 {
					t.Fatalf("recreated %d balances", n)
				}
			} else {
				var account sqlitex.CreditAccount
				if err := sqlitex.DB.Where("user_id = ?", "alice").First(&account).Error; err != nil {
					t.Fatal(err)
				}
				if account.TopupBalance != 60 {
					t.Fatalf("reward balance = %d, want 60", account.TopupBalance)
				}
			}
		})
	}
}
