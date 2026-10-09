package billing

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"enx-api/billing/credit"
)

func TestTrialGrantGrantsOnceAndCountsIt(t *testing.T) {
	ctx := context.Background()
	grants := 0
	g := TrialGrant{Amount: 100, TTL: 7 * 24 * time.Hour, Observe: func() { grants++ }}

	for i := 0; i < 2; i++ {
		if err := g.NewUser(ctx, "u-trial-hook"); err != nil {
			t.Fatalf("NewUser: %v", err)
		}
	}

	if got, _ := credit.Balance(ctx, "u-trial-hook"); got != 100 {
		t.Fatalf("Balance = %d, want 100", got)
	}
	if grants != 1 {
		t.Fatalf("observed grants = %d, want 1", grants)
	}
}

func TestTrialGrantZeroAmountGrantsNothing(t *testing.T) {
	ctx := context.Background()
	g := TrialGrant{Amount: 0, TTL: time.Hour, Observe: func() { t.Fatal("a zero-amount trial must not be counted") }}

	if err := g.NewUser(ctx, "u-trial-off"); err != nil {
		t.Fatalf("NewUser: %v", err)
	}
	if got, _ := credit.Balance(ctx, "u-trial-off"); got != 0 {
		t.Fatalf("Balance = %d, want 0", got)
	}
}

func TestMeReportsTrial(t *testing.T) {
	userID := "u-me-trial"
	before := time.Now()
	if _, err := credit.GrantTrial(context.Background(), userID, 100, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}

	h := NewHandler(nil, "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodGet, "/billing/me", h.Me, userID, ``)
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	var body struct {
		Credits struct {
			TrialBalance   int64  `json:"trialBalance"`
			TrialExpiresAt *int64 `json:"trialExpiresAt"`
		} `json:"credits"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Credits.TrialBalance != 100 {
		t.Fatalf("trialBalance = %d, want 100", body.Credits.TrialBalance)
	}
	want := before.Add(7 * 24 * time.Hour).Unix()
	if body.Credits.TrialExpiresAt == nil || *body.Credits.TrialExpiresAt < want || *body.Credits.TrialExpiresAt > want+5 {
		t.Fatalf("trialExpiresAt = %v, want about %d", body.Credits.TrialExpiresAt, want)
	}
}

func TestMeTrialExpiresAtIsNullWithoutTrial(t *testing.T) {
	h := NewHandler(nil, "https://example.com", testStripe(), nil)
	w := doRequest(t, http.MethodGet, "/billing/me", h.Me, "u-me-no-trial", ``)
	var body struct {
		Credits map[string]any `json:"credits"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if v, ok := body.Credits["trialExpiresAt"]; !ok || v != nil {
		t.Fatalf("trialExpiresAt = %v (present=%v), want null", v, ok)
	}
	if body.Credits["trialBalance"] != float64(0) {
		t.Fatalf("trialBalance = %v, want 0", body.Credits["trialBalance"])
	}
}
