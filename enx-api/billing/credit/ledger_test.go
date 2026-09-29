package credit

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"enx-api/utils"
	"enx-api/utils/sqlitex"
)

func TestMain(m *testing.M) {
	dbPath := filepath.Join(os.TempDir(), "enx-credit-ledger-test.db")
	os.Remove(dbPath)
	os.Setenv("DB_PATH", dbPath)
	utils.ViperInit()
	sqlitex.Init()
	os.Exit(m.Run())
}

func TestGrantSubscriptionResetsNotAdds(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	mustGrantSubscription(t, userID, 50, 0)
	// Simulate unused credit left over from last month, then renewal.
	if err := GrantSubscription(ctx, userID, 30, time.Now().Add(30*24*time.Hour), "evt-renewal-2"); err != nil {
		t.Fatalf("GrantSubscription: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 30 {
		t.Fatalf("got subscription_balance=%d, want 30 (reset, not 50+30=80)", acc.SubscriptionBalance)
	}
}

func TestGrantSubscriptionIdempotent(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	periodEnd := time.Now().Add(30 * 24 * time.Hour)

	if err := GrantSubscription(ctx, userID, 20, periodEnd, "evt-dup-1"); err != nil {
		t.Fatalf("first GrantSubscription: %v", err)
	}
	// Simulate a Stripe webhook retry of the same event, after the user has
	// already spent some credit -- a naive re-grant would clobber that.
	if err := Settle(ctx, userID, "translate_sentence", 5); err != nil {
		t.Fatalf("Settle: %v", err)
	}
	if err := GrantSubscription(ctx, userID, 20, periodEnd, "evt-dup-1"); err != nil {
		t.Fatalf("retried GrantSubscription: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.SubscriptionBalance != 15 {
		t.Fatalf("got subscription_balance=%d, want 15 (retry must be a no-op, not re-grant 20)", acc.SubscriptionBalance)
	}
}

func TestGrantTopupAddsAndIsIdempotent(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()

	if err := GrantTopup(ctx, userID, 10, "evt-topup-1"); err != nil {
		t.Fatalf("first GrantTopup: %v", err)
	}
	if err := GrantTopup(ctx, userID, 7, "evt-topup-2"); err != nil {
		t.Fatalf("second GrantTopup: %v", err)
	}
	if err := GrantTopup(ctx, userID, 7, "evt-topup-2"); err != nil {
		t.Fatalf("retried GrantTopup: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TopupBalance != 17 {
		t.Fatalf("got topup_balance=%d, want 17 (10+7, retry of evt-topup-2 must be a no-op)", acc.TopupBalance)
	}
}

func TestConsumeConcurrentIdempotentGrantsExactlyOnce(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()

	var wg sync.WaitGroup
	const attempts = 20
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = GrantTopup(ctx, userID, 10, "evt-racing-topup")
		}()
	}
	wg.Wait()

	acc := loadAccount(t, userID)
	if acc.TopupBalance != 10 {
		t.Fatalf("got topup_balance=%d, want 10 (event must be applied exactly once even when raced)", acc.TopupBalance)
	}
}

func mustGrantSubscription(t *testing.T, userID string, subAmount, topupAmount int64) {
	t.Helper()
	ctx := context.Background()
	if err := GrantSubscription(ctx, userID, subAmount, time.Now().Add(30*24*time.Hour), "evt-setup-"+userID+"-sub"); err != nil {
		t.Fatalf("setup GrantSubscription: %v", err)
	}
	if topupAmount > 0 {
		if err := GrantTopup(ctx, userID, topupAmount, "evt-setup-"+userID+"-topup"); err != nil {
			t.Fatalf("setup GrantTopup: %v", err)
		}
	}
}

func loadAccount(t *testing.T, userID string) sqlitex.CreditAccount {
	t.Helper()
	var acc sqlitex.CreditAccount
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&acc).Error; err != nil {
		t.Fatalf("load credit_accounts row: %v", err)
	}
	return acc
}
