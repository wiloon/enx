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
