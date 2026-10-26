//go:build integration

package repo

import (
	"context"
	"testing"
	"time"

	"enx-api/referral"
	"enx-api/utils/sqlitex"
)

func TestDueRewardsReconcilesOnlyForfeitedRowsWithTheSuppliedLedgerPrefix(t *testing.T) {
	newReferralDB(t)
	ctx := context.Background()
	refs := Referrals{}
	for _, id := range []string{"granted", "ungranted", "other-prefix"} {
		if _, err := refs.Insert(ctx, referral.Referral{InviteeID: id, Status: referral.StatusForfeited, ClaimedAt: refT0}); err != nil {
			t.Fatal(err)
		}
	}
	for _, key := range []string{"custom:granted", "referral-reward:other-prefix"} {
		key := key
		if err := sqlitex.DB.Create(&sqlitex.CreditTransaction{Id: key, Type: "GRANT_REFERRAL_REWARD", StripeEventId: &key}).Error; err != nil {
			t.Fatal(err)
		}
	}
	rows, err := refs.DueRewards(ctx, refT0, "custom:")
	if err != nil || len(rows) != 1 || rows[0].InviteeID != "granted" {
		t.Fatalf("due = %+v, %v; want only granted", rows, err)
	}
}

func TestRewardedReferralCannotBeForfeitedOrRewardedAgain(t *testing.T) {
	newReferralDB(t)
	ctx := context.Background()
	refs := Referrals{}
	if _, err := refs.Insert(ctx, referral.Referral{InviteeID: "bob", Status: referral.StatusPending, ClaimedAt: refT0}); err != nil {
		t.Fatal(err)
	}
	if err := refs.MarkRewarded(ctx, "bob", refT0); err != nil {
		t.Fatal(err)
	}
	if err := refs.MarkForfeited(ctx, "bob", "refunded", refT0.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	afterForfeit, ok, err := refs.Get(ctx, "bob")
	if err != nil || !ok || afterForfeit.Status != referral.StatusRewarded || afterForfeit.ForfeitReason != "" || !afterForfeit.RewardedAt.Equal(refT0) {
		t.Fatalf("late forfeit changed reward = %+v, %v, %v", afterForfeit, ok, err)
	}
	if err := refs.MarkRewarded(ctx, "bob", refT0.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	r, ok, err := refs.Get(ctx, "bob")
	if err != nil || !ok || r.Status != referral.StatusRewarded || r.ForfeitReason != "" || !r.RewardedAt.Equal(refT0) {
		t.Fatalf("rewarded row changed = %+v, %v, %v", r, ok, err)
	}
}
