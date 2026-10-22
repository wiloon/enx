package billing

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"enx-api/billing/credit"
	"enx-api/enx"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
)

// adminRequest drives the admin credit handler at path with the caller's
// Clerk user id on the context (what middleware.ClerkAuth sets). The
// RequireAdmin gate is tested at the router (admin_credits_test.go).
func adminRequest(t *testing.T, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	h := NewHandler(nil, "https://example.com", testStripe(), nil)
	router := gin.New()
	setCaller := func(c *gin.Context) {
		c.Set("clerk_user_id", "user_admin")
		c.Next()
	}
	router.POST("/api/admin/credits/grant", setCaller, h.GrantCredits)
	router.POST("/api/admin/credits/deduct", setCaller, h.DeductCredits)

	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

const (
	grantPath  = "/api/admin/credits/grant"
	deductPath = "/api/admin/credits/deduct"
)

func seedGrantee(t *testing.T, id, email string) *enx.User {
	t.Helper()
	u := &enx.User{Id: id, ClerkUserID: "user_" + id, Name: id, Email: email, Status: "active"}
	if err := sqlitex.DB.Create(u).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM users WHERE id = ?", u.Id)
		sqlitex.DB.Exec("DELETE FROM credit_accounts WHERE user_id = ?", u.Id)
		sqlitex.DB.Exec("DELETE FROM credit_transactions WHERE user_id = ?", u.Id)
	})
	return u
}

func TestAdminCredits_BadRequest(t *testing.T) {
	for _, path := range []string{grantPath, deductPath} {
		for _, body := range []string{
			`{"amount":100,"reason":"r"}`,                                 // no selector
			`{"email":"  ","userId":"","amount":100,"reason":"r"}`,        // blank selectors
			`{"email":"a@b.com","userId":"u1","amount":100,"reason":"r"}`, // both selectors
			`{"email":"not-an-email","amount":100,"reason":"r"}`,          // invalid email
			`{"userId":"u1","amount":0,"reason":"r"}`,                     // non-positive, by id
			`{"userId":"u1","amount":100,"reason":" "}`,                   // blank reason, by id
			`{"email":"a@b.com","reason":"r"}`,                            // missing amount
			`{"email":"a@b.com","amount":0,"reason":"r"}`,                 // non-positive
			`{"email":"a@b.com","amount":-5,"reason":"r"}`,                // negative
			`{"email":"a@b.com","amount":100}`,                            // missing reason
			`{"email":"a@b.com","amount":100,"reason":"  "}`,              // blank reason
			`not json`,
		} {
			w := adminRequest(t, path, body)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("%s body %q: status = %d, want 400", path, body, w.Code)
			}
		}
	}
}

func TestAdminCredits_UserNotFound(t *testing.T) {
	for _, path := range []string{grantPath, deductPath} {
		w := adminRequest(t, path, `{"email":"nobody@nowhere.example","amount":100,"reason":"r"}`)
		if w.Code != http.StatusNotFound {
			t.Fatalf("%s: status = %d, want 404, body=%s", path, w.Code, w.Body.String())
		}
	}
}

func TestGrantCredits_RecordsGrantAdminWithReason(t *testing.T) {
	u := seedGrantee(t, "admin-grant-target-1", "grantee@example.com")

	w := adminRequest(t, grantPath, `{"email":"grantee@example.com","amount":2500,"reason":"homelab test"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", w.Code, w.Body.String())
	}

	var body struct {
		Success bool   `json:"success"`
		UserID  string `json:"userId"`
		Granted int64  `json:"granted"`
		Balance int64  `json:"balance"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body.Success || body.UserID != u.Id || body.Granted != 2500 || body.Balance != 2500 {
		t.Fatalf("body = %+v", body)
	}

	var rows []sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ?", u.Id).Find(&rows).Error; err != nil {
		t.Fatalf("load credit_transactions: %v", err)
	}
	if len(rows) != 1 || rows[0].Type != credit.TypeGrantAdmin || rows[0].Note != "homelab test" {
		t.Fatalf("ledger rows = %+v, want one GRANT_ADMIN row noted \"homelab test\"", rows)
	}
}

func TestGrantCredits_RepeatedGrantsEachLand(t *testing.T) {
	u := seedGrantee(t, "admin-grant-target-2", "grantee2@example.com")

	adminRequest(t, grantPath, `{"email":"grantee2@example.com","amount":100,"reason":"r"}`)
	adminRequest(t, grantPath, `{"email":"grantee2@example.com","amount":100,"reason":"r"}`)

	bal, err := credit.Balance(context.Background(), u.Id)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if bal != 200 {
		t.Fatalf("two grants of 100 -> balance %d, want 200", bal)
	}
}

func TestDeductCredits_RecordsDeductAdminAndMayGoNegative(t *testing.T) {
	u := seedGrantee(t, "admin-deduct-target-1", "deductee@example.com")

	w := adminRequest(t, deductPath, `{"email":"deductee@example.com","amount":40,"reason":"granted twice"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	var body struct {
		Deducted int64 `json:"deducted"`
		Balance  int64 `json:"balance"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Deducted != 40 || body.Balance != -40 {
		t.Fatalf("body = %+v, want deducted=40 balance=-40", body)
	}

	var rows []sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ?", u.Id).Find(&rows).Error; err != nil {
		t.Fatalf("load credit_transactions: %v", err)
	}
	if len(rows) != 1 || rows[0].Type != credit.TypeDeductAdmin || rows[0].Amount != -40 || rows[0].Note != "granted twice" {
		t.Fatalf("ledger rows = %+v, want one DEDUCT_ADMIN -40 row noted \"granted twice\"", rows)
	}
}

func ledgerRows(t *testing.T, userID string) []sqlitex.CreditTransaction {
	t.Helper()
	var rows []sqlitex.CreditTransaction
	if err := sqlitex.DB.Where("user_id = ?", userID).Find(&rows).Error; err != nil {
		t.Fatalf("load credit_transactions: %v", err)
	}
	return rows
}

// #211: users.email is not unique. An email shared by two users is refused
// with the candidates, so the admin picks one by id; nothing is written.
func TestAdminCredits_AmbiguousEmailIsRefusedWithCandidates(t *testing.T) {
	stale := seedGrantee(t, "admin-dup-stale", "shared@example.com")
	login := time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)
	if err := sqlitex.DB.Model(&enx.User{}).Where("id = ?", stale.Id).Updates(map[string]any{"status": "disabled", "last_login_time": login}).Error; err != nil {
		t.Fatal(err)
	}
	current := seedGrantee(t, "admin-dup-current", "shared@example.com")

	for _, path := range []string{grantPath, deductPath} {
		w := adminRequest(t, path, `{"email":" shared@example.com ","amount":100,"reason":"r"}`)

		var body struct {
			Success    *bool  `json:"success"`
			Code       string `json:"code"`
			Message    string `json:"message"`
			Candidates []struct {
				UserID      string  `json:"userId"`
				Status      string  `json:"status"`
				LastLoginAt *string `json:"lastLoginAt"`
			} `json:"candidates"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if w.Code != http.StatusConflict || body.Success == nil || *body.Success || body.Code != "ambiguous_email" || body.Message == "" {
			t.Fatalf("%s: status %d body %s, want 409 ambiguous_email", path, w.Code, w.Body.String())
		}
		got := map[string]string{}
		for _, c := range body.Candidates {
			at := "<nil>"
			if c.LastLoginAt != nil {
				at = *c.LastLoginAt
			}
			got[c.UserID] = c.Status + " " + at
		}
		want := map[string]string{stale.Id: "disabled 2026-10-01T08:00:00Z", current.Id: "active <nil>"}
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("%s: candidates %v, want %v", path, got, want)
		}
	}
	if n := len(ledgerRows(t, stale.Id)) + len(ledgerRows(t, current.Id)); n != 0 {
		t.Fatalf("%d ledger rows written, want none", n)
	}
}

func TestAdminCredits_UserIDTargetsThatRowWhenEmailsCollide(t *testing.T) {
	seedGrantee(t, "admin-byid-other", "twin@example.com")
	target := seedGrantee(t, "admin-byid-target", "twin@example.com")

	w := adminRequest(t, grantPath, `{"userId":" admin-byid-target ","amount":30,"reason":"comp"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("grant: status %d body %s", w.Code, w.Body.String())
	}
	w = adminRequest(t, deductPath, `{"userId":"admin-byid-target","amount":10,"reason":"oops"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("deduct: status %d body %s", w.Code, w.Body.String())
	}

	if rows := ledgerRows(t, target.Id); len(rows) != 2 {
		t.Fatalf("target ledger = %+v, want the grant and the deduction", rows)
	}
	if rows := ledgerRows(t, "admin-byid-other"); len(rows) != 0 {
		t.Fatalf("the other row got ledger rows %+v", rows)
	}
	if bal, err := credit.Balance(context.Background(), target.Id); err != nil || bal != 20 {
		t.Fatalf("balance = %d, %v; want 20", bal, err)
	}
}

// userId is the enx id only: a Clerk id, or an id that matches nobody, is a
// 404, never a fallback to email.
func TestAdminCredits_UnknownUserIDIsNotFound(t *testing.T) {
	u := seedGrantee(t, "admin-byid-known", "known@example.com")
	for _, path := range []string{grantPath, deductPath} {
		for _, id := range []string{"no-such-user", u.ClerkUserID, u.Email} {
			w := adminRequest(t, path, `{"userId":"`+id+`","amount":100,"reason":"r"}`)
			if w.Code != http.StatusNotFound {
				t.Fatalf("%s userId %q: status %d, want 404", path, id, w.Code)
			}
		}
	}
	if rows := ledgerRows(t, u.Id); len(rows) != 0 {
		t.Fatalf("ledger rows %+v, want none", rows)
	}
}
