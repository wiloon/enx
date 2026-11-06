package main

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
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

type ledgerSeed struct {
	id, userID, txnType, feature, note string
	amount                             int64
	total                              *int64
	stripe                             bool // carries Stripe ids and a related row
}

func seedLedger(t *testing.T, base time.Time, rows ...ledgerSeed) {
	t.Helper()
	for i, r := range rows {
		row := sqlitex.CreditTransaction{
			Id: r.id, UserId: r.userID, Type: r.txnType, Amount: r.amount, BalanceAfter: 999,
			TotalBalanceAfter: r.total, Feature: r.feature, Note: r.note,
			CreatedAt: base.Add(time.Duration(i) * time.Minute).UnixMilli(),
		}
		if r.stripe {
			evt, pi, related := "evt_"+r.id, "pi_"+r.id, "related_"+r.id
			row.StripeEventId, row.StripePaymentIntentId, row.RelatedTransactionId = &evt, &pi, &related
		}
		if err := sqlitex.DB.Create(&row).Error; err != nil {
			t.Fatalf("seed %s: %v", r.id, err)
		}
	}
}

func ptr(n int64) *int64 { return &n }

// fetchLedger walks a ledger endpoint page by page and returns every row.
func fetchLedger(t *testing.T, url, token string, limit int) []map[string]any {
	t.Helper()
	var out []map[string]any
	next := ""
	for range 20 {
		page := url + "&limit=" + strconv.Itoa(limit)
		if next != "" {
			page += "&before=" + next
		}
		code, body := doJSON(t, http.MethodGet, page, token)
		if code != http.StatusOK {
			t.Fatalf("GET %s: status %d body %v", page, code, body)
		}
		for _, r := range body["transactions"].([]any) {
			out = append(out, r.(map[string]any))
		}
		next, _ = body["next"].(string)
		if next == "" {
			return out
		}
	}
	t.Fatalf("GET %s: ledger did not end", url)
	return nil
}

func ledgerTypes(rows []map[string]any) string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r["type"].(string)
	}
	return strings.Join(out, " ")
}

// ADR-063 Decision 3 and 5: the user's own ledger, with none of the internal
// fields and the note on admin rows only.
func TestE2E_MyCreditHistory_OwnRowsUserFieldsOnly(t *testing.T) {
	base, adminToken, plainToken := adminDictEnv(t)
	plainID := signedInUserID(t, base, plainToken, nonAdminSub)
	adminID := signedInUserID(t, base, adminToken, adminSub)
	seedLedger(t, time.Now().Add(-time.Hour),
		ledgerSeed{id: "p1", userID: plainID, txnType: "GRANT_TOPUP", amount: 300, stripe: true},
		ledgerSeed{id: "a1", userID: adminID, txnType: "GRANT_TOPUP", amount: 700, total: ptr(700), stripe: true},
		ledgerSeed{id: "p2", userID: plainID, txnType: "SETTLE", feature: "translate_sentence", amount: -40, total: ptr(260)},
		ledgerSeed{id: "p3", userID: plainID, txnType: "GRANT_ADMIN", note: "support comp", amount: 25, total: ptr(285)},
		ledgerSeed{id: "p4", userID: plainID, txnType: "CLAWBACK", note: "ch_secret", amount: -90, total: ptr(195), stripe: true},
		ledgerSeed{id: "p5", userID: plainID, txnType: "GRANT_SUBSCRIPTION", amount: 0, total: ptr(195), stripe: true},
	)

	rows := fetchLedger(t, base+"/api/me/credits/transactions?", plainToken, 2)
	if got, want := ledgerTypes(rows), "GRANT_SUBSCRIPTION CLAWBACK GRANT_ADMIN SETTLE GRANT_TOPUP"; got != want {
		t.Fatalf("ledger = %q, want %q (the plain user's rows only)", got, want)
	}
	for _, r := range rows {
		keys := make([]string, 0, len(r))
		for k := range r {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		want := "amount createdAt feature totalBalanceAfter type"
		if r["type"] == "GRANT_ADMIN" {
			want = "amount createdAt feature note totalBalanceAfter type"
		}
		if got := strings.Join(keys, " "); got != want {
			t.Errorf("%s row keys = %q, want %q", r["type"], got, want)
		}
	}
	if r := rows[2]; r["note"] != "support comp" || r["amount"] != float64(25) || r["totalBalanceAfter"] != float64(285) {
		t.Errorf("GRANT_ADMIN row = %v", r)
	}
	if r := rows[3]; r["feature"] != "translate_sentence" || r["amount"] != float64(-40) {
		t.Errorf("SETTLE row = %v", r)
	}
	if r := rows[4]; r["totalBalanceAfter"] != nil {
		t.Errorf("old row totalBalanceAfter = %v, want null", r["totalBalanceAfter"])
	}
	if _, err := time.Parse(time.RFC3339Nano, rows[0]["createdAt"].(string)); err != nil {
		t.Errorf("createdAt: %v", err)
	}

	if got, want := ledgerTypes(fetchLedger(t, base+"/api/me/credits/transactions?direction=in", plainToken, 1)), "GRANT_ADMIN GRANT_TOPUP"; got != want {
		t.Errorf("direction=in: %q, want %q", got, want)
	}
	if got, want := ledgerTypes(fetchLedger(t, base+"/api/me/credits/transactions?direction=out", plainToken, 1)), "CLAWBACK SETTLE"; got != want {
		t.Errorf("direction=out: %q, want %q", got, want)
	}
}

// ADR-063 Decision 2-3 and 7: the admin's timeline gains the same filter and
// the three-pool total.
func TestE2E_AdminUsers_LedgerDirectionAndTotal(t *testing.T) {
	base, adminToken, plainToken := adminDictEnv(t)
	plainID := signedInUserID(t, base, plainToken, nonAdminSub)
	seedLedger(t, time.Now().Add(-time.Hour),
		ledgerSeed{id: "p1", userID: plainID, txnType: "GRANT_TOPUP", amount: 300},
		ledgerSeed{id: "p2", userID: plainID, txnType: "SETTLE", feature: "translate_sentence", amount: -40, total: ptr(260)},
		ledgerSeed{id: "p3", userID: plainID, txnType: "CLAWBACK", note: "ch_1", amount: 0, total: ptr(260)},
	)
	url := base + "/api/admin/users/" + plainID + "/transactions?"

	rows := fetchLedger(t, url, adminToken, 50)
	if got, want := ledgerTypes(rows), "CLAWBACK SETTLE GRANT_TOPUP"; got != want {
		t.Fatalf("ledger = %q, want %q", got, want)
	}
	if rows[1]["totalBalanceAfter"] != float64(260) || rows[1]["source"] != "ai" {
		t.Errorf("SETTLE row = %v, want totalBalanceAfter 260 and source ai", rows[1])
	}
	if v, ok := rows[2]["totalBalanceAfter"]; !ok || v != nil {
		t.Errorf("old row totalBalanceAfter = %v (present %v), want null", v, ok)
	}
	if rows[0]["note"] != "ch_1" || rows[0]["balanceAfter"] != float64(999) {
		t.Errorf("CLAWBACK row = %v, want the admin's full fields", rows[0])
	}
	if got := ledgerTypes(fetchLedger(t, url+"direction=in", adminToken, 1)); got != "GRANT_TOPUP" {
		t.Errorf("direction=in: %q, want GRANT_TOPUP", got)
	}
	if got := ledgerTypes(fetchLedger(t, url+"direction=out", adminToken, 1)); got != "SETTLE" {
		t.Errorf("direction=out: %q, want SETTLE", got)
	}
}

// ADR-063 Decision 2 (#669 Decision 3): an unknown direction is a client
// bug, so it fails instead of showing the unfiltered list.
func TestE2E_CreditHistory_UnknownDirectionIs400(t *testing.T) {
	base, adminToken, plainToken := adminDictEnv(t)
	plainID := signedInUserID(t, base, plainToken, nonAdminSub)

	for _, tc := range []struct{ path, token string }{
		{"/api/me/credits/transactions?direction=added", plainToken},
		{"/api/admin/users/" + plainID + "/transactions?direction=added", adminToken},
		{"/api/admin/users/no-such-user/transactions?direction=added", adminToken},
	} {
		if code, body := doJSON(t, http.MethodGet, base+tc.path, tc.token); code != http.StatusBadRequest {
			t.Errorf("GET %s: status %d (%v), want 400", tc.path, code, body)
		}
	}
	if code, _ := doJSON(t, http.MethodGet, base+"/api/me/credits/transactions", ""); code != http.StatusUnauthorized {
		t.Errorf("unauthenticated: status %d, want 401", code)
	}
}
