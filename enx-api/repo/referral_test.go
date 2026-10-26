package repo

import (
	"context"
	"testing"
	"time"

	"enx-api/account"
	"enx-api/referral"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func newReferralDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&sqlitex.User{}, &sqlitex.CreditTransaction{},
		&sqlitex.ReferralCode{}, &sqlitex.Referral{}); err != nil {
		t.Fatal(err)
	}
	prev := sqlitex.DB
	sqlitex.DB = db
	t.Cleanup(func() { sqlitex.DB = prev })
}

var refT0 = time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)

func TestReferralCodesOnePerUserAndUnique(t *testing.T) {
	newReferralDB(t)
	ctx := context.Background()
	codes := ReferralCodes{}

	if ok, err := codes.Insert(ctx, "alice", "AAAAAAAA", refT0); err != nil || !ok {
		t.Fatalf("Insert = %v, %v; want inserted", ok, err)
	}
	if ok, err := codes.Insert(ctx, "alice", "BBBBBBBB", refT0); err != nil || ok {
		t.Fatalf("second code for alice = %v, %v; want not inserted, no error", ok, err)
	}
	if ok, err := codes.Insert(ctx, "bob", "AAAAAAAA", refT0); err != nil || ok {
		t.Fatalf("alice's code for bob = %v, %v; want not inserted, no error", ok, err)
	}

	if code, ok, err := codes.CodeOf(ctx, "alice"); err != nil || !ok || code != "AAAAAAAA" {
		t.Fatalf("CodeOf(alice) = %q, %v, %v", code, ok, err)
	}
	if _, ok, _ := codes.CodeOf(ctx, "bob"); ok {
		t.Fatal("bob has a code")
	}
	if owner, ok, err := codes.OwnerOf(ctx, "AAAAAAAA"); err != nil || !ok || owner != "alice" {
		t.Fatalf("OwnerOf = %q, %v, %v", owner, ok, err)
	}
	if _, ok, _ := codes.OwnerOf(ctx, "ZZZZZZZZ"); ok {
		t.Fatal("an unknown code has an owner")
	}
}

func TestReferralsLifecycle(t *testing.T) {
	newReferralDB(t)
	ctx := context.Background()
	refs := Referrals{}

	claim := referral.Referral{InviteeID: "bob", ReferrerID: "alice", Code: "AAAAAAAA", ClaimedAt: refT0, Status: referral.StatusClaimed}
	if ok, err := refs.Insert(ctx, claim); err != nil || !ok {
		t.Fatalf("Insert = %v, %v", ok, err)
	}
	if ok, err := refs.Insert(ctx, referral.Referral{InviteeID: "bob", ReferrerID: "carol", Code: "CCCCCCCC", ClaimedAt: refT0, Status: referral.StatusClaimed}); err != nil || ok {
		t.Fatalf("second claim by bob = %v, %v; want not inserted", ok, err)
	}
	got, ok, err := refs.Get(ctx, "bob")
	if err != nil || !ok || got.ReferrerID != "alice" || got.FirstPayment != nil || !got.ClaimedAt.Equal(refT0) {
		t.Fatalf("Get = %+v, %v, %v", got, ok, err)
	}

	paid := referral.FirstPayment{Kind: referral.KindSubscription, InvoiceID: "in_1", Credits: 500, PaidAt: refT0.Add(time.Hour)}
	due := refT0.Add(15 * 24 * time.Hour)
	reward := referral.Reward{Status: referral.StatusPending, Amount: 300, DueAt: due}
	if ok, err := refs.RecordFirstPayment(ctx, "bob", paid, reward); err != nil || !ok {
		t.Fatalf("RecordFirstPayment = %v, %v", ok, err)
	}
	if ok, err := refs.RecordFirstPayment(ctx, "bob", referral.FirstPayment{Kind: referral.KindTopup, PaymentIntentID: "pi_2", Credits: 1}, reward); err != nil || ok {
		t.Fatalf("second RecordFirstPayment = %v, %v; want not recorded", ok, err)
	}
	got, _, _ = refs.Get(ctx, "bob")
	if got.FirstPayment == nil || *got.FirstPayment != paid || got.Status != referral.StatusPending ||
		got.RewardAmount != 300 || !got.RewardDueAt.Equal(due) {
		t.Fatalf("after payment = %+v (%+v)", got, got.FirstPayment)
	}

	if rows, _ := refs.DueRewards(ctx, due.Add(-time.Second), "referral-reward:"); len(rows) != 0 {
		t.Fatalf("due before the date = %+v", rows)
	}
	rows, err := refs.DueRewards(ctx, due, "referral-reward:")
	if err != nil || len(rows) != 1 || rows[0].InviteeID != "bob" {
		t.Fatalf("DueRewards = %+v, %v", rows, err)
	}

	if err := refs.SetPaymentIntent(ctx, "bob", "pi_1"); err != nil {
		t.Fatal(err)
	}
	if err := refs.MarkRewarded(ctx, "bob", due); err != nil {
		t.Fatal(err)
	}
	got, _, _ = refs.Get(ctx, "bob")
	if got.FirstPayment.PaymentIntentID != "pi_1" || got.Status != referral.StatusRewarded || !got.RewardedAt.Equal(due) {
		t.Fatalf("after reward = %+v", got)
	}
	// Settled rows are no longer due, and a late forfeit cannot undo a reward.
	if rows, _ := refs.DueRewards(ctx, due, "referral-reward:"); len(rows) != 0 {
		t.Fatalf("due after reward = %+v", rows)
	}
	if err := refs.MarkForfeited(ctx, "bob", "refunded", due); err != nil {
		t.Fatal(err)
	}
	if got, _, _ = refs.Get(ctx, "bob"); got.Status != referral.StatusRewarded {
		t.Fatalf("status = %s, want still rewarded", got.Status)
	}
}

func TestReferralsMarkForfeited(t *testing.T) {
	newReferralDB(t)
	ctx := context.Background()
	refs := Referrals{}
	_, _ = refs.Insert(ctx, referral.Referral{InviteeID: "bob", ReferrerID: "alice", Code: "AAAAAAAA", ClaimedAt: refT0, Status: referral.StatusClaimed})
	_, _ = refs.RecordFirstPayment(ctx, "bob", referral.FirstPayment{Kind: referral.KindTopup, PaymentIntentID: "pi_1", Credits: 300, PaidAt: refT0},
		referral.Reward{Status: referral.StatusPending, Amount: 60, DueAt: refT0})

	if err := refs.MarkForfeited(ctx, "bob", "disputed", refT0); err != nil {
		t.Fatal(err)
	}
	got, _, _ := refs.Get(ctx, "bob")
	if got.Status != referral.StatusForfeited || got.ForfeitReason != "disputed" {
		t.Fatalf("after forfeit = %+v", got)
	}
}

func TestReferralsKeepRewardsBlocked(t *testing.T) {
	newReferralDB(t)
	ctx := context.Background()
	refs := Referrals{}
	_, _ = refs.Insert(ctx, referral.Referral{InviteeID: "bob", ReferrerID: "alice", Code: "A", ClaimedAt: refT0,
		Status: referral.StatusClaimed, RewardsBlocked: true})
	_, _ = refs.Insert(ctx, referral.Referral{InviteeID: "carol", ReferrerID: "alice", Code: "A", ClaimedAt: refT0,
		Status: referral.StatusClaimed})

	if got, _, _ := refs.Get(ctx, "bob"); !got.RewardsBlocked {
		t.Fatalf("bob = %+v, want rewards blocked", got)
	}
	if got, _, _ := refs.Get(ctx, "carol"); got.RewardsBlocked {
		t.Fatalf("carol = %+v, want rewards not blocked", got)
	}
}

func TestReferralsByReferrer(t *testing.T) {
	newReferralDB(t)
	ctx := context.Background()
	refs := Referrals{}
	for _, r := range []referral.Referral{
		{InviteeID: "bob", ReferrerID: "alice", Code: "A", ClaimedAt: refT0, Status: referral.StatusClaimed},
		{InviteeID: "carol", ReferrerID: "alice", Code: "A", ClaimedAt: refT0, Status: referral.StatusClaimed},
		{InviteeID: "dave", ReferrerID: "erin", Code: "E", ClaimedAt: refT0, Status: referral.StatusClaimed},
	} {
		if _, err := refs.Insert(ctx, r); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := refs.ByReferrer(ctx, "alice")
	if err != nil || len(rows) != 2 {
		t.Fatalf("ByReferrer = %+v, %v; want bob and carol", rows, err)
	}
}

func TestReferralAccounts(t *testing.T) {
	newReferralDB(t)
	ctx := context.Background()
	if err := sqlitex.DB.Create(&sqlitex.User{Id: "bob", Name: "bob", Email: "bob@x", CreatedAt: refT0}).Error; err != nil {
		t.Fatal(err)
	}
	accounts := ReferralAccounts{}

	created, err := accounts.CreatedAt(ctx, "bob")
	if err != nil || !created.Equal(refT0) {
		t.Fatalf("CreatedAt = %v, %v; want %v", created, err, refT0)
	}
	if _, err := accounts.CreatedAt(ctx, "nobody"); err == nil {
		t.Fatal("CreatedAt of a missing user succeeded")
	}

	if paid, err := accounts.HasPaid(ctx, "bob"); err != nil || paid {
		t.Fatalf("HasPaid before any purchase = %v, %v", paid, err)
	}
	// A trial or a referral bonus is not a payment.
	for i, typ := range []string{"GRANT_TRIAL", "GRANT_REFERRAL_BONUS", "GRANT_ADMIN"} {
		addTxn(t, "bob", typ, i)
	}
	if paid, _ := accounts.HasPaid(ctx, "bob"); paid {
		t.Fatal("HasPaid counted a free grant")
	}
	for i, typ := range []string{"GRANT_TOPUP", "GRANT_SUBSCRIPTION"} {
		user := []string{"carol", "dave"}[i]
		addTxn(t, user, typ, 10+i)
		if paid, _ := accounts.HasPaid(ctx, user); !paid {
			t.Fatalf("HasPaid after %s = false", typ)
		}
	}
}

func TestReferralAccountsExistsUntilTheAccountIsDeleted(t *testing.T) {
	newAccountDB(t)
	ctx := context.Background()
	seedAccount(t, "alice", "alice@example.com")
	seedAccount(t, "dora", "dora@example.com")
	if err := (Accounts{}).SetStatus(ctx, "dora", account.StatusDisabled); err != nil {
		t.Fatal(err)
	}
	accounts := ReferralAccounts{}

	for _, id := range []string{"alice", "dora"} {
		if ok, err := accounts.Exists(ctx, id); err != nil || !ok {
			t.Fatalf("Exists(%s) = %v, %v; want true (a disabled account still exists)", id, ok, err)
		}
	}
	if err := (Accounts{}).DeleteData(ctx, "alice"); err != nil {
		t.Fatalf("DeleteData: %v", err)
	}
	if ok, err := accounts.Exists(ctx, "alice"); err != nil || ok {
		t.Fatalf("Exists after deletion = %v, %v; want false", ok, err)
	}

	if err := sqlitex.DB.Migrator().DropTable(&sqlitex.User{}); err != nil {
		t.Fatal(err)
	}
	if _, err := accounts.Exists(ctx, "dora"); err == nil {
		t.Fatal("Exists without a users table succeeded, want the lookup error")
	}
}

func addTxn(t *testing.T, userID, typ string, n int) {
	t.Helper()
	if err := sqlitex.DB.Create(&sqlitex.CreditTransaction{
		Id: userID + typ, UserId: userID, Type: typ, Amount: 1, CreatedAt: int64(n),
	}).Error; err != nil {
		t.Fatal(err)
	}
}
