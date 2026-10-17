package main

import (
	"net/http"
	"testing"
)

// ADR-049: admin grant and deduct sit behind RequireAdmin like the other
// admin routes.
func TestE2E_AdminCredits_RequiresAdmin(t *testing.T) {
	base, _, plainToken := adminDictEnv(t)

	body := map[string]any{"email": "plain@example.com", "amount": 10, "reason": "test"}
	for _, path := range []string{"/api/admin/credits/grant", "/api/admin/credits/deduct"} {
		if code, _ := doJSONBody(t, http.MethodPost, base+path, plainToken, body); code != http.StatusForbidden {
			t.Errorf("POST %s as non-admin: status = %d, want 403", path, code)
		}
		if code, _ := doJSONBody(t, http.MethodPost, base+path, "", body); code != http.StatusUnauthorized {
			t.Errorf("POST %s unauthenticated: status = %d, want 401", path, code)
		}
	}
}

func TestE2E_AdminCredits_GrantThenDeduct(t *testing.T) {
	base, adminToken, plainToken := adminDictEnv(t)
	// The target must have signed in once to exist in users.
	if code, _ := doJSON(t, http.MethodGet, base+"/api/me", plainToken); code != http.StatusOK {
		t.Fatalf("GET /api/me as target: status = %d", code)
	}

	code, body := doJSONBody(t, http.MethodPost, base+"/api/admin/credits/grant", adminToken,
		map[string]any{"email": "plain@example.com", "amount": 100, "reason": "support comp"})
	if code != http.StatusOK || body["balance"] != float64(100) {
		t.Fatalf("grant: status = %d, body = %v; want 200 with balance 100", code, body)
	}

	code, body = doJSONBody(t, http.MethodPost, base+"/api/admin/credits/deduct", adminToken,
		map[string]any{"email": "plain@example.com", "amount": 30, "reason": "granted twice"})
	if code != http.StatusOK || body["balance"] != float64(70) {
		t.Fatalf("deduct: status = %d, body = %v; want 200 with balance 70", code, body)
	}
}
