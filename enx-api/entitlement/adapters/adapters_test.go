package adapters

import (
	"context"
	"testing"
	"time"

	"enx-api/billing/credit"
	"enx-api/utils/sqlitex"
	"enx-api/utils/sqlitex/sqlitextest"

	"gorm.io/gorm"
)

func TestBillingIsActiveSubscriber(t *testing.T) {
	db := sqlitextest.Open(t)
	for _, status := range []string{"active", "canceled", "none"} {
		if err := db.Exec("INSERT INTO users (id,accepted_subscription_id) VALUES (?,?)", status, "sub_"+status).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Exec("INSERT INTO subscriptions (stripe_subscription_id,user_id,stripe_customer_id,status,created_at,updated_at) VALUES (?,?,?,?,1,1)", "sub_"+status, status, "cus_"+status, status).Error; err != nil {
			t.Fatal(err)
		}
	}

	for user, want := range map[string]bool{"active": true, "canceled": false, "none": false, "no-row": false} {
		got, err := NewBilling(db, nil).IsActiveSubscriber(context.Background(), user)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("IsActiveSubscriber(%q) = %v, want %v", user, got, want)
		}
	}
}

func TestBillingTopupBalance(t *testing.T) {
	db := sqlitextest.Open(t)
	for _, a := range []sqlitex.CreditAccount{
		{UserId: "funded", TopupBalance: 40, UpdatedAt: 1},
		{UserId: "overdrawn", TopupBalance: -5, UpdatedAt: 1},
	} {
		if err := db.Create(&a).Error; err != nil {
			t.Fatal(err)
		}
	}
	for user, want := range map[string]int64{"funded": 40, "overdrawn": -5, "no-account": 0} {
		got, err := NewBilling(db, nil).TopupBalance(context.Background(), user)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("TopupBalance(%q) = %d, want %d", user, got, want)
		}
	}
}

func TestBillingTrialBalance(t *testing.T) {
	db := sqlitextest.Open(t)
	ctx := context.Background()
	for _, id := range []string{"trialist", "expired", "empty"} {
		if err := db.Exec("INSERT INTO users (id) VALUES (?)", id).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, err := credit.GrantTrialTx(tx, "trialist", "h:trialist", 100, time.Hour)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for user, want := range map[string]int64{"trialist": 100, "nobody": 0} {
		got, err := NewBilling(db, nil).TrialBalance(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("TrialBalance(%q) = %d, want %d", user, got, want)
		}
	}
}

func TestBillingTopupBalanceUsesTheHandleItWasBuiltOn(t *testing.T) {
	first := sqlitextest.Open(t)
	// Open points the global at the handle it opened last.
	second := sqlitextest.Open(t)
	for db, balance := range map[*gorm.DB]int64{first: 11, second: 22} {
		if err := db.Create(&sqlitex.CreditAccount{UserId: "u1", TopupBalance: balance, UpdatedAt: 1}).Error; err != nil {
			t.Fatal(err)
		}
	}

	got, err := NewBilling(first, nil).TopupBalance(context.Background(), "u1")
	if err != nil {
		t.Fatal(err)
	}
	if got != 11 {
		t.Errorf("TopupBalance = %d, want 11 from the first database", got)
	}
}
