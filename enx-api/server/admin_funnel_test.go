package server

import (
	"net/http"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestE2E_AdminFunnel_RequiresAdmin(t *testing.T) {
	base, _, plainToken := adminDictEnv(t)

	if code, _ := doJSON(t, http.MethodGet, base+"/api/admin/funnel", plainToken); code != http.StatusForbidden {
		t.Errorf("non-admin: status = %d, want 403", code)
	}
	if code, _ := doJSON(t, http.MethodGet, base+"/api/admin/funnel", ""); code != http.StatusUnauthorized {
		t.Errorf("unauthenticated: status = %d, want 401", code)
	}
}

// Wiring: the route counts the real store's accounts without the allowlisted
// admin, and answers counts only. The steps are covered in funnel and its
// adapters.
func TestE2E_AdminFunnel_CountsAccountsWithoutAdmins(t *testing.T) {
	base, adminToken, plainToken := adminDictEnv(t)
	signedInUserID(t, base, plainToken, nonAdminSub)
	signedInUserID(t, base, adminToken, adminSub)

	code, body := doJSON(t, http.MethodGet, base+"/api/admin/funnel", adminToken)
	cohorts, _ := body["cohorts"].([]any)
	if code != http.StatusOK || len(cohorts) != 12 {
		t.Fatalf("status %d body %v, want 12 cohorts", code, body)
	}

	today := time.Now().UTC()
	monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
	want := map[string]any{
		"weekStart": monday.Format(time.DateOnly), "signedUp": float64(1), "firstLookup": float64(0),
		"threeLookupDays": nil, "week2": nil, "week4": nil,
		"firstAiCall": float64(0), "trialEnded": float64(0), "firstPayment": float64(0),
	}
	if !reflect.DeepEqual(cohorts[0], want) {
		t.Errorf("newest cohort = %v, want %v", cohorts[0], want)
	}
	weeks := make([]string, len(cohorts))
	for i, c := range cohorts {
		weeks[i], _ = c.(map[string]any)["weekStart"].(string)
	}
	if !slices.IsSortedFunc(weeks, func(a, b string) int { return strings.Compare(b, a) }) {
		t.Errorf("weeks = %v, want newest first", weeks)
	}
}
