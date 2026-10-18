package adapters

import (
	"context"
	"testing"
	"time"

	"enx-api/referral"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func newLedgerDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&sqlitex.CreditAccount{}, &sqlitex.CreditTransaction{}); err != nil {
		t.Fatal(err)
	}
	prev := sqlitex.DB
	sqlitex.DB = db
	t.Cleanup(func() { sqlitex.DB = prev })
}

func TestLedgerGrantsTheInviteeBonusIntoTheTrialPool(t *testing.T) {
	newLedgerDB(t)
	expires := time.Now().Add(14 * 24 * time.Hour).Truncate(time.Second)

	got, err := Ledger{}.GrantInviteeBonus(context.Background(), "bob", referral.Bonus{
		Amount: 100, ExpiresAt: expires, TrialAmount: 100, TrialTTL: 7 * 24 * time.Hour,
	})
	if err != nil {
		t.Fatalf("GrantInviteeBonus: %v", err)
	}
	if !got.Equal(expires) {
		t.Fatalf("expiry = %v, want %v", got, expires)
	}
	var acc sqlitex.CreditAccount
	sqlitex.DB.Where("user_id = ?", "bob").First(&acc)
	if acc.TrialBalance != 200 {
		t.Fatalf("trial = %d, want 200 (backfilled trial + bonus)", acc.TrialBalance)
	}
}

func TestLedgerGrantsTheReferrerRewardIntoTheTopupPool(t *testing.T) {
	newLedgerDB(t)
	if err := (Ledger{}).GrantReferrerReward(context.Background(), "alice", 300, "referral-reward:bob"); err != nil {
		t.Fatalf("GrantReferrerReward: %v", err)
	}
	var acc sqlitex.CreditAccount
	sqlitex.DB.Where("user_id = ?", "alice").First(&acc)
	if acc.TopupBalance != 300 {
		t.Fatalf("topup = %d, want 300", acc.TopupBalance)
	}
}
