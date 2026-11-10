package main

import (
	"context"
	"net/http"
	"testing"
	"time"

	"enx-api/billing/credit"
	"enx-api/repo"
	"enx-api/utils/sqlitex"
)

// ADR-049 Decision 11: the users page API sits behind RequireAdmin.
func TestE2E_AdminUsers_RequiresAdmin(t *testing.T) {
	base, _, plainToken := adminDictEnv(t)

	for _, path := range []string{"/api/admin/users", "/api/admin/users/x", "/api/admin/users/x/transactions"} {
		if code, _ := doJSON(t, http.MethodGet, base+path, plainToken); code != http.StatusForbidden {
			t.Errorf("GET %s as non-admin: status = %d, want 403", path, code)
		}
		if code, _ := doJSON(t, http.MethodGet, base+path, ""); code != http.StatusUnauthorized {
			t.Errorf("GET %s unauthenticated: status = %d, want 401", path, code)
		}
	}
}

// Wiring: the three admin users routes read the real store, so a user's
// credit grant, AI spend and lookups show on the list, the detail and the
// ledger. The totals, usage window, sorts and status mapping are covered in
// adminuser and repo.
func TestE2E_AdminUsers_ListDetailAndLedger(t *testing.T) {
	base, adminToken, plainToken := adminDictEnv(t)
	userID := signedInUserID(t, base, plainToken, nonAdminSub)
	ctx := context.Background()
	if err := credit.GrantAdmin(ctx, userID, 70, "support comp"); err != nil {
		t.Fatalf("GrantAdmin: %v", err)
	}
	if err := credit.Settle(ctx, userID, "translate_sentence", 40); err != nil {
		t.Fatalf("Settle: %v", err)
	}
	if err := repo.AddLookupEvent(ctx, sqlitex.LookupEvent{UserID: userID, At: time.Now().UnixMilli(), Outcome: "allowed"}); err != nil {
		t.Fatalf("AddLookupEvent: %v", err)
	}

	code, body := doJSON(t, http.MethodGet, base+"/api/admin/users?q=plain@", adminToken)
	users, _ := body["users"].([]any)
	if code != http.StatusOK || len(users) != 1 {
		t.Fatalf("list: status %d body %v, want the plain user", code, body)
	}
	row := users[0].(map[string]any)
	if row["id"] != userID || row["balances"].(map[string]any)["total"] != float64(30) || row["totals"].(map[string]any)["consumed"] != float64(40) {
		t.Fatalf("list row = %v, want a total of 30 after 70 granted and 40 consumed", row)
	}

	code, body = doJSON(t, http.MethodGet, base+"/api/admin/users/"+userID, adminToken)
	days, _ := body["dailyLookups"].([]any)
	spend, _ := body["aiSpend"].([]any)
	if code != http.StatusOK || len(days) != 30 || days[29].(map[string]any)["count"] != float64(1) ||
		len(spend) != 1 || spend[0].(map[string]any)["credits"] != float64(40) {
		t.Fatalf("detail: status %d body %v, want today's lookup and 40 credits of AI spend", code, body)
	}

	code, body = doJSON(t, http.MethodGet, base+"/api/admin/users/"+userID+"/transactions", adminToken)
	rows, _ := body["transactions"].([]any)
	if code != http.StatusOK || len(rows) != 2 || rows[0].(map[string]any)["source"] != "ai" || rows[1].(map[string]any)["source"] != "admin" {
		t.Fatalf("ledger: status %d body %v, want the settle then the grant with their sources", code, body)
	}
}
