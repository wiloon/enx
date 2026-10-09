package billing

import (
	"bytes"
	"context"
	"encoding/json"
	"enx-api/middleware"
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/billing/credit"
	"enx-api/enx"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
)

// adminRequest drives GrantCredits with the caller's Clerk user id on the
// context (what middleware.ClerkAuth sets).
func adminRequest(t *testing.T, callerClerkID, body string) *httptest.ResponseRecorder {
	t.Helper()
	return adminRequestWith(t, middleware.NewAdminAllowlist([]string{"user_admin"}), callerClerkID, body)
}

func adminRequestWith(t *testing.T, admins middleware.AdminAllowlist, callerClerkID, body string) *httptest.ResponseRecorder {
	t.Helper()
	h := NewHandler(nil, "https://example.com", testStripe(), nil).WithAdmins(admins)
	router := gin.New()
	router.POST("/api/admin/credits/grant", func(c *gin.Context) {
		c.Set("clerk_user_id", callerClerkID)
		c.Next()
	}, h.GrantCredits)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/credits/grant", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func TestGrantCredits_ForbiddenForNonAdmin(t *testing.T) {
	w := adminRequest(t, "user_notadmin", `{"email":"a@b.com","amount":100}`)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403, body=%s", w.Code, w.Body.String())
	}
}

func TestGrantCredits_ForbiddenWhenAllowlistEmpty(t *testing.T) {
	w := adminRequestWith(t, middleware.AdminAllowlist{}, "user_anyone", `{"email":"a@b.com","amount":100}`)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403, body=%s", w.Code, w.Body.String())
	}
}

func TestGrantCredits_BadRequest(t *testing.T) {
	for _, body := range []string{
		`{"amount":100}`,                  // missing email
		`{"email":"a@b.com"}`,             // missing amount
		`{"email":"a@b.com","amount":0}`,  // non-positive
		`{"email":"a@b.com","amount":-5}`, // negative
		`not json`,
	} {
		w := adminRequest(t, "user_admin", body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("body %q: status = %d, want 400", body, w.Code)
		}
	}
}

func TestGrantCredits_UserNotFound(t *testing.T) {
	w := adminRequest(t, "user_admin", `{"email":"nobody@nowhere.example","amount":100}`)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body=%s", w.Code, w.Body.String())
	}
}

func TestGrantCredits_HappyPath(t *testing.T) {
	u := &enx.User{Id: "admin-grant-target-1", Name: "grantee", Email: "grantee@example.com", Status: "active"}
	if err := sqlitex.DB.Create(u).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM users WHERE id = ?", u.Id)
		sqlitex.DB.Exec("DELETE FROM credit_accounts WHERE user_id = ?", u.Id)
		sqlitex.DB.Exec("DELETE FROM credit_transactions WHERE user_id = ?", u.Id)
	})

	w := adminRequest(t, "user_admin", `{"email":"grantee@example.com","amount":2500,"reason":"homelab test"}`)
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

	bal, err := credit.Balance(context.Background(), u.Id)
	if err != nil || bal != 2500 {
		t.Fatalf("Balance() = %d, %v; want 2500", bal, err)
	}

	var ledgerCount int64
	sqlitex.DB.Model(&sqlitex.CreditTransaction{}).
		Where("user_id = ? AND type = ?", u.Id, credit.TypeGrantTopup).Count(&ledgerCount)
	if ledgerCount != 1 {
		t.Fatalf("ledger rows = %d, want 1", ledgerCount)
	}
}

func TestGrantCredits_IdempotencyKeyIsUnique(t *testing.T) {
	u := &enx.User{Id: "admin-grant-target-2", Name: "grantee2", Email: "grantee2@example.com", Status: "active"}
	if err := sqlitex.DB.Create(u).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM users WHERE id = ?", u.Id)
		sqlitex.DB.Exec("DELETE FROM credit_accounts WHERE user_id = ?", u.Id)
		sqlitex.DB.Exec("DELETE FROM credit_transactions WHERE user_id = ?", u.Id)
	})

	adminRequest(t, "user_admin", `{"email":"grantee2@example.com","amount":100}`)
	adminRequest(t, "user_admin", `{"email":"grantee2@example.com","amount":100}`)

	bal, _ := credit.Balance(context.Background(), u.Id)
	if bal != 200 {
		t.Fatalf("two grants of 100 -> balance %d, want 200 (each grant needs a fresh idempotency key)", bal)
	}
}
