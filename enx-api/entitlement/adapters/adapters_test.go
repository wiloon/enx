package adapters

import (
	"context"
	"testing"
	"time"

	"enx-api/billing/credit"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func setupBillingDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&sqlitex.Subscription{}, &sqlitex.CreditAccount{}, &sqlitex.CreditTransaction{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
}

func TestBillingIsActiveSubscriber(t *testing.T) {
	setupBillingDB(t)
	for _, s := range []sqlitex.Subscription{
		{UserId: "active", StripeCustomerId: "c1", Status: "active", CreatedAt: 1, UpdatedAt: 1},
		{UserId: "canceled", StripeCustomerId: "c2", Status: "canceled", CreatedAt: 1, UpdatedAt: 1},
		{UserId: "none", StripeCustomerId: "c3", Status: "none", CreatedAt: 1, UpdatedAt: 1},
	} {
		if err := sqlitex.DB.Create(&s).Error; err != nil {
			t.Fatal(err)
		}
	}
	for user, want := range map[string]bool{"active": true, "canceled": false, "none": false, "no-row": false} {
		got, err := Billing{}.IsActiveSubscriber(context.Background(), user)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("IsActiveSubscriber(%q) = %v, want %v", user, got, want)
		}
	}
}

func TestBillingTopupBalance(t *testing.T) {
	setupBillingDB(t)
	for _, a := range []sqlitex.CreditAccount{
		{UserId: "funded", TopupBalance: 40, UpdatedAt: 1},
		{UserId: "overdrawn", TopupBalance: -5, UpdatedAt: 1},
	} {
		if err := sqlitex.DB.Create(&a).Error; err != nil {
			t.Fatal(err)
		}
	}
	for user, want := range map[string]int64{"funded": 40, "overdrawn": -5, "no-account": 0} {
		got, err := Billing{}.TopupBalance(context.Background(), user)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("TopupBalance(%q) = %d, want %d", user, got, want)
		}
	}
}

func TestBillingTrialBalance(t *testing.T) {
	setupBillingDB(t)
	ctx := context.Background()
	if _, err := credit.GrantTrial(ctx, "trialist", 100, time.Hour); err != nil {
		t.Fatal(err)
	}
	for user, want := range map[string]int64{"trialist": 100, "nobody": 0} {
		got, err := Billing{}.TrialBalance(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("TrialBalance(%q) = %d, want %d", user, got, want)
		}
	}
}
