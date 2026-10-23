package credit

import (
	"context"
	"errors"
	"testing"
	"time"

	"enx-api/utils/sqlitex"
)

// Referral credits (ADR-051): the invitee's bonus goes into the trial pool,
// the referrer's reward into the top-up pool.

func TestGrantReferralBonusAddsToTrialAndExtendsExpiry(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	start := time.Now().Truncate(time.Second)
	setClock(t, start)
	mustGrantTrial(t, userID, 100, 7*24*time.Hour)

	want := start.Add(14 * 24 * time.Hour)
	expires, err := GrantReferralBonus(ctx, userID, ReferralBonus{Amount: 100, ExpiresAt: want})
	if err != nil {
		t.Fatalf("GrantReferralBonus: %v", err)
	}
	if !expires.Equal(want) {
		t.Fatalf("trialExpiresAt = %v, want %v", expires, want)
	}
	acc := loadAccount(t, userID)
	if acc.TrialBalance != 200 || acc.TrialExpiresAt == nil || *acc.TrialExpiresAt != want.Unix() {
		t.Fatalf("got trial=%d expires=%v, want 200 / %d", acc.TrialBalance, acc.TrialExpiresAt, want.Unix())
	}
	var rows []sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ? AND type = ?", userID, TypeGrantReferralBonus).Find(&rows).Error; err != nil {
		t.Fatalf("load GRANT_REFERRAL_BONUS rows: %v", err)
	}
	if len(rows) != 1 || rows[0].Amount != 100 || rows[0].BalanceAfter != 200 ||
		rows[0].StripeEventId == nil || *rows[0].StripeEventId != "referral-bonus:"+userID {
		t.Fatalf("GRANT_REFERRAL_BONUS rows = %+v, want one row of 100 keyed referral-bonus:<id>", rows)
	}
}

func TestGrantReferralBonusKeepsALaterExpiry(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	start := time.Now().Truncate(time.Second)
	setClock(t, start)
	mustGrantTrial(t, userID, 100, 30*24*time.Hour)

	expires, err := GrantReferralBonus(ctx, userID, ReferralBonus{Amount: 100, ExpiresAt: start.Add(14 * 24 * time.Hour)})
	if err != nil {
		t.Fatalf("GrantReferralBonus: %v", err)
	}
	if want := start.Add(30 * 24 * time.Hour); !expires.Equal(want) {
		t.Fatalf("trialExpiresAt = %v, want the existing %v", expires, want)
	}
}

func TestGrantReferralBonusIsIdempotentPerInvitee(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantTrial(t, userID, 100, 7*24*time.Hour)
	bonus := ReferralBonus{Amount: 100, ExpiresAt: time.Now().Add(14 * 24 * time.Hour)}

	if _, err := GrantReferralBonus(ctx, userID, bonus); err != nil {
		t.Fatalf("GrantReferralBonus: %v", err)
	}
	if _, err := GrantReferralBonus(ctx, userID, bonus); err != nil {
		t.Fatalf("replayed GrantReferralBonus: %v", err)
	}
	if acc := loadAccount(t, userID); acc.TrialBalance != 200 {
		t.Fatalf("trial = %d, want 200 (a replay grants nothing)", acc.TrialBalance)
	}
}

func TestGrantReferralBonusIssuesAMissingTrialFirst(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	start := time.Now().Truncate(time.Second)
	setClock(t, start)

	_, err := GrantReferralBonus(ctx, userID, ReferralBonus{
		Amount: 100, ExpiresAt: start.Add(14 * 24 * time.Hour),
		TrialAmount: 100, TrialTTL: 7 * 24 * time.Hour, EmailHMAC: "email-" + userID,
	})
	if err != nil {
		t.Fatalf("GrantReferralBonus: %v", err)
	}
	if acc := loadAccount(t, userID); acc.TrialBalance != 200 {
		t.Fatalf("trial = %d, want 200 (trial 100 + bonus 100)", acc.TrialBalance)
	}
	var count int64
	if err := sqlitex.DB.Model(&sqlitex.CreditTransaction{}).Where("user_id = ? AND type = ?", userID, TypeGrantTrial).Count(&count).Error; err != nil {
		t.Fatalf("count GRANT_TRIAL rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("GRANT_TRIAL rows = %d, want 1", count)
	}
	// The trial is still once per account.
	granted, err := GrantTrial(ctx, userID, "email-"+userID, 100, time.Hour)
	if err != nil {
		t.Fatalf("GrantTrial: %v", err)
	}
	if granted {
		t.Fatal("GrantTrial granted again after the backfill")
	}
}

// seedUser gives userID a users row: the referrer reward goes only to an
// account that still exists.
func seedUser(t *testing.T, userID string) {
	t.Helper()
	if err := sqlitex.DB.Create(&sqlitex.User{
		Id: userID, ClerkUserID: "clerk_" + userID, Name: userID, Status: "active", CreatedAt: time.Now(),
	}).Error; err != nil {
		t.Fatalf("seed users row: %v", err)
	}
}

func countReferralRewards(t *testing.T, userID string) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Model(&sqlitex.CreditTransaction{}).
		Where("user_id = ? AND type = ?", userID, TypeGrantReferralReward).Count(&n).Error; err != nil {
		t.Fatalf("count GRANT_REFERRAL_REWARD rows: %v", err)
	}
	return n
}

func countCreditAccounts(t *testing.T, userID string) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Model(&sqlitex.CreditAccount{}).Where("user_id = ?", userID).Count(&n).Error; err != nil {
		t.Fatalf("count credit_accounts rows: %v", err)
	}
	return n
}

func TestGrantReferralRewardToAMissingUserGrantsNothing(t *testing.T) {
	userID := "u-" + t.Name()

	err := GrantReferralReward(context.Background(), userID, 300, "referral-reward:invitee-of-"+userID)
	if !errors.Is(err, ErrNoUser) {
		t.Fatalf("GrantReferralReward = %v, want ErrNoUser", err)
	}
	if n := countCreditAccounts(t, userID); n != 0 {
		t.Fatalf("credit_accounts rows = %d, want none created", n)
	}
	if n := countReferralRewards(t, userID); n != 0 {
		t.Fatalf("GRANT_REFERRAL_REWARD rows = %d, want none", n)
	}
}

func TestGrantReferralRewardReplayedAfterDeletionChangesNothing(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	key := "referral-reward:invitee-of-" + userID
	seedUser(t, userID)
	if err := GrantReferralReward(ctx, userID, 300, key); err != nil {
		t.Fatalf("GrantReferralReward: %v", err)
	}
	for _, table := range []string{"credit_accounts WHERE user_id", "users WHERE id"} {
		if err := sqlitex.DB.Exec("DELETE FROM "+table+" = ?", userID).Error; err != nil {
			t.Fatalf("delete the account: %v", err)
		}
	}

	if err := GrantReferralReward(ctx, userID, 300, key); err != nil {
		t.Fatalf("replayed GrantReferralReward = %v, want the processed key to be a no-op", err)
	}
	if n := countCreditAccounts(t, userID); n != 0 {
		t.Fatalf("credit_accounts rows = %d, want none recreated", n)
	}
	if n := countReferralRewards(t, userID); n != 1 {
		t.Fatalf("GRANT_REFERRAL_REWARD rows = %d, want the one retained", n)
	}
}

func TestGrantReferralRewardAddsToTopupWithoutAPaymentIntent(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedUser(t, userID)
	mustGrantSubscription(t, userID, 1, 40)

	if err := GrantReferralReward(ctx, userID, 300, "referral-reward:invitee-1"); err != nil {
		t.Fatalf("GrantReferralReward: %v", err)
	}
	if err := GrantReferralReward(ctx, userID, 300, "referral-reward:invitee-1"); err != nil {
		t.Fatalf("replayed GrantReferralReward: %v", err)
	}
	if acc := loadAccount(t, userID); acc.TopupBalance != 340 {
		t.Fatalf("topup = %d, want 340 (granted once)", acc.TopupBalance)
	}
	var rows []sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ? AND type = ?", userID, TypeGrantReferralReward).Find(&rows).Error; err != nil {
		t.Fatalf("load GRANT_REFERRAL_REWARD rows: %v", err)
	}
	if len(rows) != 1 || rows[0].Amount != 300 || rows[0].BalanceAfter != 340 || rows[0].StripePaymentIntentId != nil {
		t.Fatalf("GRANT_REFERRAL_REWARD rows = %+v, want one row of 300 with no payment intent", rows)
	}
}

func TestGrantReferralRewardRejectsANonPositiveAmount(t *testing.T) {
	if err := GrantReferralReward(context.Background(), "u-"+t.Name(), 0, "referral-reward:x"); err == nil {
		t.Fatal("GrantReferralReward(0) succeeded, want an error")
	}
}
