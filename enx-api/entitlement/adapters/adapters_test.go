package adapters

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"enx-api/billing/credit"
	"enx-api/utils/sqlitex"
)

func setupBillingDB(t *testing.T) {
	t.Helper()
	prev := sqlitex.DB
	sqlitex.Init(filepath.Join(t.TempDir(), "billing.db"))
	db := sqlitex.DB
	t.Cleanup(func() { raw, _ := db.DB(); _ = raw.Close(); sqlitex.DB = prev })
}

func TestBillingIsActiveSubscriber(t *testing.T) {
	setupBillingDB(t)
	for _, status := range []string{"active", "canceled", "none"} {
		if err := sqlitex.DB.Exec("INSERT INTO users (id,accepted_subscription_id) VALUES (?,?)", status, "sub_"+status).Error; err != nil {
			t.Fatal(err)
		}
		if err := sqlitex.DB.Exec("INSERT INTO subscriptions (stripe_subscription_id,user_id,stripe_customer_id,status,created_at,updated_at) VALUES (?,?,?,?,1,1)", "sub_"+status, status, "cus_"+status, status).Error; err != nil {
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
	for _, id := range []string{"trialist", "expired", "empty"} {
		if err := sqlitex.DB.Exec("INSERT INTO users (id) VALUES (?)", id).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := credit.GrantTrial(ctx, "trialist", "h:trialist", 100, time.Hour); err != nil {
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
