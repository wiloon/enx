package main

import (
	"net/http"
	"testing"
	"time"

	"enx-api/utils/sqlitex"
)

// signedInUserID signs sub's token in once and returns their users.id.
func signedInUserID(t *testing.T, base, token, sub string) string {
	t.Helper()
	if code, _ := doJSON(t, http.MethodGet, base+"/api/me", token); code != http.StatusOK {
		t.Fatalf("GET /api/me as %s: status %d", sub, code)
	}
	var u sqlitex.User
	if err := sqlitex.DB.Where("clerk_user_id = ?", sub).First(&u).Error; err != nil {
		t.Fatalf("load user %s: %v", sub, err)
	}
	return u.Id
}

// ADR-063 Decision 3 wiring: the route reads the signed-in user's own ledger
// from credit_transactions, row by row as the user sees it. The fields, the
// direction filter and paging are covered in handlers, creditledger and repo.
func TestE2E_MyCreditHistory_ShowsTheSignedInUsersOwnRows(t *testing.T) {
	base, adminToken, plainToken := adminDictEnv(t)
	plainID := signedInUserID(t, base, plainToken, nonAdminSub)
	adminID := signedInUserID(t, base, adminToken, adminSub)
	at := time.Now().Add(-time.Hour).UnixMilli()
	for _, row := range []sqlitex.CreditTransaction{
		{Id: "p1", UserId: plainID, Type: "GRANT_ADMIN", Amount: 25, BalanceAfter: 25, Note: "support comp", CreatedAt: at},
		{Id: "a1", UserId: adminID, Type: "GRANT_TOPUP", Amount: 700, BalanceAfter: 700, CreatedAt: at},
	} {
		if err := sqlitex.DB.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}

	code, body := doJSON(t, http.MethodGet, base+"/api/me/credits/transactions", plainToken)
	rows, _ := body["transactions"].([]any)
	if code != http.StatusOK || len(rows) != 1 {
		t.Fatalf("GET: status %d body %v, want the plain user's one row", code, body)
	}
	row := rows[0].(map[string]any)
	if row["type"] != "GRANT_ADMIN" || row["amount"] != float64(25) || row["note"] != "support comp" {
		t.Fatalf("row = %v, want the GRANT_ADMIN of 25", row)
	}
	if _, ok := row["balanceAfter"]; ok {
		t.Fatalf("row = %v, want the user's fields only", row)
	}
}
