package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"enx-api/referral"

	"github.com/gin-gonic/gin"
)

// fakeReferralService answers with canned values and records the claim.
type fakeReferralService struct {
	summary   referral.Summary
	claim     referral.ClaimResult
	claimErr  error
	offer     referral.Offer
	claimedBy string
	claimCode string
}

func (f *fakeReferralService) Me(_ context.Context, _ string) (referral.Summary, error) {
	return f.summary, nil
}

func (f *fakeReferralService) Claim(_ context.Context, inviteeID, code string) (referral.ClaimResult, error) {
	f.claimedBy, f.claimCode = inviteeID, code
	return f.claim, f.claimErr
}

func (f *fakeReferralService) Offer() referral.Offer { return f.offer }

// serveReferral runs one request through h's routes; userID, when not "", is
// the signed-in user clerkAuth would have set.
func serveReferral(t *testing.T, h *ReferralHandler, userID, method, path, body string) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if userID != "" {
			c.Set("user_id", userID)
		}
	})
	r.GET("/referral/me", h.Me)
	r.POST("/referral/claim", h.Claim)
	r.GET("/referral/offer", h.Offer)

	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("response %q is not JSON: %v", w.Body.String(), err)
	}
	return w.Code, out
}

func TestReferralMeReturnsTheLinkAndCounts(t *testing.T) {
	due := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	svc := &fakeReferralService{summary: referral.Summary{
		Code: "ABCDEFGH", Invited: 3, Paid: 2, TotalEarned: 60,
		Pending: []referral.PendingReward{{Amount: 300, DueAt: due}},
	}}

	code, body := serveReferral(t, NewReferralHandler(svc, "https://catglish.com/"), "alice", http.MethodGet, "/referral/me", "")
	if code != http.StatusOK {
		t.Fatalf("status = %d, body %v", code, body)
	}
	if body["code"] != "ABCDEFGH" || body["link"] != "https://catglish.com/invite/ABCDEFGH" {
		t.Fatalf("code/link = %v / %v", body["code"], body["link"])
	}
	if body["invited"] != 3.0 || body["paid"] != 2.0 || body["totalEarned"] != 60.0 {
		t.Fatalf("counts = %v", body)
	}
	pending := body["pendingRewards"].([]any)
	if len(pending) != 1 {
		t.Fatalf("pendingRewards = %v, want one", pending)
	}
	if p := pending[0].(map[string]any); p["amount"] != 300.0 || p["dueAt"] != float64(due.Unix()) {
		t.Fatalf("pending reward = %v, want 300 due %d (Unix seconds)", p, due.Unix())
	}
}

func TestReferralMeWithNoPendingRewardsSendsAnEmptyList(t *testing.T) {
	svc := &fakeReferralService{summary: referral.Summary{Code: "ABCDEFGH"}}
	_, body := serveReferral(t, NewReferralHandler(svc, ""), "alice", http.MethodGet, "/referral/me", "")
	if list, ok := body["pendingRewards"].([]any); !ok || len(list) != 0 {
		t.Fatalf("pendingRewards = %#v, want []", body["pendingRewards"])
	}
}

func TestReferralClaimReturnsTheBonus(t *testing.T) {
	expires := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	svc := &fakeReferralService{claim: referral.ClaimResult{Bonus: 100, TrialExpiresAt: expires}}

	code, body := serveReferral(t, NewReferralHandler(svc, ""), "bob", http.MethodPost, "/referral/claim", `{"code":"abcdefgh"}`)
	if code != http.StatusOK || body["success"] != true {
		t.Fatalf("status = %d, body %v", code, body)
	}
	if body["bonus"] != 100.0 || body["trialExpiresAt"] != float64(expires.Unix()) {
		t.Fatalf("body = %v, want bonus 100 and the expiry", body)
	}
	if svc.claimedBy != "bob" || svc.claimCode != "abcdefgh" {
		t.Fatalf("claimed by %q with %q", svc.claimedBy, svc.claimCode)
	}
}

func TestReferralClaimWithoutABonusHasANullExpiry(t *testing.T) {
	svc := &fakeReferralService{}
	code, body := serveReferral(t, NewReferralHandler(svc, ""), "bob", http.MethodPost, "/referral/claim", `{"code":"ABCDEFGH"}`)
	if code != http.StatusOK || body["bonus"] != 0.0 || body["trialExpiresAt"] != nil {
		t.Fatalf("status %d, body %v; want bonus 0 and a null expiry", code, body)
	}
}

func TestReferralClaimRefusalIs409WithTheReason(t *testing.T) {
	svc := &fakeReferralService{claimErr: &referral.ClaimError{Reason: referral.ReasonClaimWindowClosed}}
	code, body := serveReferral(t, NewReferralHandler(svc, ""), "bob", http.MethodPost, "/referral/claim", `{"code":"ABCDEFGH"}`)
	if code != http.StatusConflict || body["reason"] != "claim_window_closed" || body["success"] != false || body["message"] == "" {
		t.Fatalf("status %d, body %v; want 409 claim_window_closed with a message", code, body)
	}
}

func TestReferralClaimFailureIs500(t *testing.T) {
	svc := &fakeReferralService{claimErr: errors.New("db down")}
	code, _ := serveReferral(t, NewReferralHandler(svc, ""), "bob", http.MethodPost, "/referral/claim", `{"code":"ABCDEFGH"}`)
	if code != http.StatusInternalServerError {
		t.Fatalf("status %d, want 500", code)
	}
}

func TestReferralClaimWithoutACodeIs400(t *testing.T) {
	code, _ := serveReferral(t, NewReferralHandler(&fakeReferralService{}, ""), "bob", http.MethodPost, "/referral/claim", `{}`)
	if code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", code)
	}
}

func TestReferralOfferNeedsNoSignIn(t *testing.T) {
	svc := &fakeReferralService{offer: referral.Offer{Credits: 200, Days: 14}}
	code, body := serveReferral(t, NewReferralHandler(svc, ""), "", http.MethodGet, "/referral/offer", "")
	if code != http.StatusOK || body["credits"] != 200.0 || body["days"] != 14.0 {
		t.Fatalf("status %d, body %v; want 200 credits / 14 days", code, body)
	}
}
