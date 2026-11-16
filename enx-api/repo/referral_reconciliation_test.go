//go:build integration

package repo

import (
	"context"
	"testing"

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
		if err := sqlitex.DB.Create(&sqlitex.CreditTransaction{Id: key, Type: "GRANT_REFERRAL_REWARD", StripeEventId: &key}).Error; err != nil {
			t.Fatal(err)
		}
	}
	rows, err := refs.DueRewards(ctx, refT0, "custom:")
	if err != nil || len(rows) != 1 || rows[0].InviteeID != "granted" {
		t.Fatalf("due = %+v, %v; want only granted", rows, err)
	}
}
