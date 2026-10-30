package billing

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"enx-api/billing/credit"
)

func TestTrialGrantGrantsOnceAndCountsIt(t *testing.T) {
	cleanupBillingUser(t, "u-trial-hook")
	seedUser(t, "u-trial-hook")
	ctx := context.Background()
	grants := 0
	g := TrialGrant{Amount: 100, TTL: 7 * 24 * time.Hour, EmailHMAC: fakeHMAC, Observe: func() { grants++ }}

	for i := 0; i < 2; i++ {
		if err := g.NewUser(ctx, "u-trial-hook", "hook@example.com"); err != nil {
			t.Fatalf("NewUser: %v", err)
		}
	}

	got, err := credit.Balance(ctx, "u-trial-hook")
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 100 {
		t.Fatalf("Balance = %d, want 100", got)
	}
	if grants != 1 {
		t.Fatalf("observed grants = %d, want 1", grants)
	}
}

func TestTrialGrantZeroAmountGrantsNothing(t *testing.T) {
	ctx := context.Background()
	g := TrialGrant{Amount: 0, TTL: time.Hour, EmailHMAC: fakeHMAC, Observe: func() { t.Fatal("a zero-amount trial must not be counted") }}

	if err := g.NewUser(ctx, "u-trial-off", "off@example.com"); err != nil {
		t.Fatalf("NewUser: %v", err)
	}
	got, err := credit.Balance(ctx, "u-trial-off")
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 0 {
		t.Fatalf("Balance = %d, want 0", got)
	}
}

// ADR-062 Decision 3: the email decides, so a second account with the same
// email (case and spaces aside, which the HMAC folds) gets no trial.
func TestTrialGrantSkipsAnEmailThatAlreadyHadATrial(t *testing.T) {
	cleanupBillingUser(t, "u-trial-email-1")
	cleanupBillingUser(t, "u-trial-email-2")
	seedUser(t, "u-trial-email-1")
	seedUser(t, "u-trial-email-2")
	ctx := context.Background()
	hmac := func(email string) string { return "h:" + strings.ToLower(strings.TrimSpace(email)) }
	g := TrialGrant{Amount: 100, TTL: time.Hour, EmailHMAC: hmac}

	if err := g.NewUser(ctx, "u-trial-email-1", "again@example.com"); err != nil {
		t.Fatalf("NewUser: %v", err)
	}
	if err := g.NewUser(ctx, "u-trial-email-2", " Again@Example.com "); err != nil {
		t.Fatalf("NewUser: %v", err)
	}
	got, err := credit.Balance(ctx, "u-trial-email-2")
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 0 {
		t.Fatalf("Balance = %d, want 0 for a re-registered email", got)
	}
}

func TestTrialGrantWithoutAnEmailGrantsNothing(t *testing.T) {
	ctx := context.Background()
	g := TrialGrant{Amount: 100, TTL: time.Hour, EmailHMAC: fakeHMAC,
		Observe: func() { t.Fatal("no email, no trial") }}

	if err := g.NewUser(ctx, "u-trial-no-email", ""); err != nil {
		t.Fatalf("NewUser: %v", err)
	}
	got, err := credit.Balance(ctx, "u-trial-no-email")
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got != 0 {
		t.Fatalf("Balance = %d, want 0", got)
	}
}

// fakeHMAC stands in for account.EmailHMAC: "" for a blank email.
func fakeHMAC(email string) string {
	if strings.TrimSpace(email) == "" {
		return ""
	}
	return "h:" + email
}

func TestMeReportsTrial(t *testing.T) {
	userID := "u-me-trial"
	seedUser(t, userID)
	cleanupBillingUser(t, userID)
	before := time.Now()
	if _, err := credit.GrantTrial(context.Background(), userID, "h:"+userID, 100, 7*24*time.Hour); err != nil {
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
