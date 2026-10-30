package credit

import (
	"context"
	"testing"

	"enx-api/utils/sqlitex"
)

func TestGrantAdminAddsToTopupPoolWithReason(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantSubscription(t, userID, 50, 10)

	if err := GrantAdmin(ctx, userID, 25, "support comp for outage"); err != nil {
		t.Fatalf("GrantAdmin: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TopupBalance != 35 || acc.SubscriptionBalance != 50 {
		t.Fatalf("got topup=%d subscription=%d, want topup=35 subscription=50", acc.TopupBalance, acc.SubscriptionBalance)
	}
	row := lastLedgerRow(t, userID)
	if row.Type != TypeGrantAdmin || row.Amount != 25 || row.BalanceAfter != 35 || row.Note != "support comp for outage" {
		t.Fatalf("ledger row = %+v, want GRANT_ADMIN +25 balanceAfter=35 with the reason as note", row)
	}
}

func TestGrantAdminRejectsNonPositiveAmountOrEmptyReason(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantSubscription(t, userID, 50, 10)

	for _, tc := range []struct {
		amount int64
		note   string
	}{{0, "reason"}, {-5, "reason"}, {10, ""}} {
		if err := GrantAdmin(ctx, userID, tc.amount, tc.note); err == nil {
			t.Fatalf("GrantAdmin(%d, %q) = nil, want an error", tc.amount, tc.note)
		}
	}
	if acc := loadAccount(t, userID); acc.TopupBalance != 10 {
		t.Fatalf("topup = %d, want 10 (unchanged)", acc.TopupBalance)
	}
}

func TestDeductAdminTakesFromTopupPoolAndMayGoNegative(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantSubscription(t, userID, 50, 10)

	if err := DeductAdmin(ctx, userID, 30, "comp granted twice by mistake"); err != nil {
		t.Fatalf("DeductAdmin: %v", err)
	}

	acc := loadAccount(t, userID)
	if acc.TopupBalance != -20 || acc.SubscriptionBalance != 50 {
		t.Fatalf("got topup=%d subscription=%d, want topup=-20 subscription=50", acc.TopupBalance, acc.SubscriptionBalance)
	}
	row := lastLedgerRow(t, userID)
	if row.Type != TypeDeductAdmin || row.Amount != -30 || row.BalanceAfter != -20 || row.Note != "comp granted twice by mistake" {
		t.Fatalf("ledger row = %+v, want DEDUCT_ADMIN -30 balanceAfter=-20 with the reason as note", row)
	}
}

func TestDeductAdminRejectsNonPositiveAmountOrEmptyReason(t *testing.T) {
	ctx := context.Background()
	userID := "u-" + t.Name()
	seedCreditUser(t, userID)
	mustGrantSubscription(t, userID, 50, 10)

	for _, tc := range []struct {
		amount int64
		note   string
	}{{0, "reason"}, {-5, "reason"}, {10, ""}} {
		if err := DeductAdmin(ctx, userID, tc.amount, tc.note); err == nil {
			t.Fatalf("DeductAdmin(%d, %q) = nil, want an error", tc.amount, tc.note)
		}
	}
	if acc := loadAccount(t, userID); acc.TopupBalance != 10 {
		t.Fatalf("topup = %d, want 10 (unchanged)", acc.TopupBalance)
	}
}

func lastLedgerRow(t *testing.T, userID string) sqlitex.CreditTransaction {
	t.Helper()
	var row sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ?", userID).Order("created_at DESC, rowid DESC").First(&row).Error; err != nil {
		t.Fatalf("load last ledger row: %v", err)
	}
	return row
}
