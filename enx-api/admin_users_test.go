package main

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"enx-api/billing/chargerefunded"
	"enx-api/billing/checkoutcompleted"
	"enx-api/billing/credit"
	billingstripe "enx-api/billing/stripe"
	"enx-api/billing/webhookdispatch"
	"enx-api/billing/webhookevent"
	"enx-api/referral"
	"enx-api/repo"
	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
	"github.com/stripe/stripe-go/v86/webhook"
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

// plainUserID signs the plain user in once and returns their users.id.
func plainUserID(t *testing.T, base, plainToken string) string {
	t.Helper()
	if code, _ := doJSON(t, http.MethodGet, base+"/api/me", plainToken); code != http.StatusOK {
		t.Fatalf("GET /api/me: status %d", code)
	}
	var u sqlitex.User
	if err := sqlitex.DB.Where("clerk_user_id = ?", nonAdminSub).First(&u).Error; err != nil {
		t.Fatalf("load plain user: %v", err)
	}
	return u.Id
}

func TestE2E_AdminUsers_ListDetailAndLedger(t *testing.T) {
	base, adminToken, plainToken := adminDictEnv(t)
	userID := plainUserID(t, base, plainToken)
	ctx := context.Background()
	deliver := adminUsersWebhooks(t)
	deliver("evt_topup", "checkout.session.completed", `{"id":"cs_topup","object":"checkout.session","mode":"payment","client_reference_id":"`+userID+`","customer":null,"payment_intent":"pi_topup","payment_status":"paid","metadata":{"type":"topup","tier":"small"}}`)
	if err := credit.Settle(ctx, userID, "translate_sentence", 40); err != nil {
		t.Fatalf("Settle: %v", err)
	}
	if err := credit.GrantAdmin(ctx, userID, 25, "support comp"); err != nil {
		t.Fatalf("GrantAdmin: %v", err)
	}
	deliver("evt_refund", "charge.refunded", `{"id":"ch_topup","object":"charge","payment_intent":"pi_topup","amount_refunded":150,"amount_captured":499}`)
	today := time.Now().UTC()
	for _, at := range []time.Time{today, today, today.AddDate(0, 0, -2), today.AddDate(0, 0, -40)} {
		if err := repo.AddLookupEvent(ctx, sqlitex.LookupEvent{UserID: userID, At: at.UnixMilli(), Outcome: "allowed"}); err != nil {
			t.Fatalf("AddLookupEvent: %v", err)
		}
	}

	// List, filtered to the plain user by email.
	code, body := doJSON(t, http.MethodGet, base+"/api/admin/users?q=plain@&sort=balance", adminToken)
	if code != http.StatusOK || body["total"] != float64(1) {
		t.Fatalf("list: status %d body %v; want 200 with total 1", code, body)
	}
	row := body["users"].([]any)[0].(map[string]any)
	if row["id"] != userID || row["email"] != "plain@example.com" || row["hadClawback"] != true {
		t.Fatalf("list row = %v", row)
	}
	// 300 − 40 + 25 − floor(300 × 150 / 499) = 195
	if b := row["balances"].(map[string]any); b["topup"] != float64(195) || b["total"] != float64(195) {
		t.Fatalf("balances = %v, want topup and total 195", b)
	}
	totals := row["totals"].(map[string]any)
	if totals["paid"] != float64(300) || totals["gifted"] != float64(25) || totals["consumed"] != float64(40) || totals["clawedBack"] != float64(90) {
		t.Fatalf("totals = %v", totals)
	}

	// Detail: usage over the last 30 UTC days.
	code, body = doJSON(t, http.MethodGet, base+"/api/admin/users/"+userID, adminToken)
	if code != http.StatusOK {
		t.Fatalf("detail: status %d body %v", code, body)
	}
	days := body["dailyLookups"].([]any)
	if len(days) != 30 {
		t.Fatalf("dailyLookups = %d days, want 30", len(days))
	}
	var lookups float64
	for _, d := range days {
		lookups += d.(map[string]any)["count"].(float64)
	}
	if last := days[29].(map[string]any); last["date"] != today.Format(time.DateOnly) || last["count"] != float64(2) || lookups != 3 {
		t.Fatalf("last day = %v, total = %v; want today with 2 and 3 in all (the 40-day-old one is outside)", last, lookups)
	}
	spend := body["aiSpend"].([]any)
	if len(spend) != 1 || spend[0].(map[string]any)["feature"] != "translate_sentence" || spend[0].(map[string]any)["credits"] != float64(40) {
		t.Fatalf("aiSpend = %v, want translate_sentence 40", spend)
	}
	if u := body["user"].(map[string]any); u["stripeDashboardUrl"] != "" {
		t.Fatalf("stripeDashboardUrl = %v, want empty (no Stripe customer)", u["stripeDashboardUrl"])
	}

	// Ledger, newest first, two per page.
	var types []string
	next := ""
	for range 5 {
		url := base + "/api/admin/users/" + userID + "/transactions?limit=2"
		if next != "" {
			url += "&before=" + next
		}
		code, body = doJSON(t, http.MethodGet, url, adminToken)
		if code != http.StatusOK {
			t.Fatalf("transactions: status %d body %v", code, body)
		}
		for _, r := range body["transactions"].([]any) {
			m := r.(map[string]any)
			types = append(types, m["type"].(string)+"/"+m["source"].(string))
		}
		next, _ = body["next"].(string)
		if next == "" {
			break
		}
	}
	if got, want := strings.Join(types, " "), "CLAWBACK/refund GRANT_ADMIN/admin SETTLE/ai GRANT_TOPUP/stripe"; got != want {
		t.Fatalf("ledger = %q, want %q", got, want)
	}
}

// adminUsersWebhooks returns a function that delivers one signed Stripe
// event to the production receiver and has a worker decide it with the
// production checkout and refund handlers: a 300-credit "small" top-up.
func adminUsersWebhooks(t *testing.T) func(eventID, eventType, object string) {
	t.Helper()
	ctx := context.Background()
	endpoint := webhookevent.Endpoint{AccountID: "acct_test"}
	receiver := webhookevent.NewReceiver(func(p []byte, sig string) error { return billingstripe.VerifyWebhook(p, sig, "whsec_test") },
		func() webhookevent.Endpoint { return endpoint }, repo.WebhookReceipts{}, time.Now, uuid.NewString)
	handlers := adminUsersWebhookHandlers{
		webhookevent.KindCheckout: checkoutcompleted.NewHandler(repo.CheckoutCompleted{Endpoint: endpoint}, map[string]int64{"small": 300}),
		webhookevent.KindRefund:   chargerefunded.NewHandler(repo.ChargeRefunds{}, adminUsersNoStripe{}),
	}
	store := repo.NewWebhookEvents(repo.WebhookEffects{Now: time.Now, Referral: referral.FixedPolicy{}}.Apply)
	worker := webhookevent.NewWorker(store, handlers, webhookevent.WorkerSettings{Timeout: time.Second, Lease: time.Minute, BackoffMin: time.Second, BackoffMax: time.Minute, DependencyWaitDeadline: time.Hour}, time.Now, uuid.NewString)
	return func(eventID, eventType, object string) {
		t.Helper()
		payload := []byte(`{"id":"` + eventID + `","object":"event","type":"` + eventType + `","created":1790000000,"api_version":"2026-08-26.dahlia","livemode":false,"data":{"object":` + object + `}}`)
		signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: "whsec_test"})
		if outcome := receiver.Receive(ctx, signed.Payload, signed.Header); !outcome.Accepted {
			t.Fatalf("receipt of %s: %+v", eventID, outcome)
		}
		if report, err := worker.Pass(ctx); err != nil || report.Processed != 1 {
			t.Fatalf("processing %s: %+v %v, want it processed", eventID, report, err)
		}
	}
}

type adminUsersWebhookHandlers map[webhookevent.Kind]webhookdispatch.KindHandler

func (h adminUsersWebhookHandlers) Handle(ctx context.Context, kind webhookevent.Kind, task webhookevent.StoredTask) webhookevent.Result {
	return h[kind].Handle(ctx, task)
}

// adminUsersNoStripe fails every call: refunding a top-up needs no Stripe.
type adminUsersNoStripe struct{}

func (adminUsersNoStripe) SubscriptionStatus(context.Context, string) (string, error) {
	return "", errors.New("unexpected Stripe subscription lookup")
}

func (adminUsersNoStripe) CancelSubscriptionNow(context.Context, string) error {
	return errors.New("unexpected Stripe cancellation")
}

func TestE2E_AdminUsers_SortAndFilter(t *testing.T) {
	base, adminToken, plainToken := adminDictEnv(t)
	plainID := plainUserID(t, base, plainToken) // signs up first
	time.Sleep(1100 * time.Millisecond)         // users.created_at has second precision
	if code, _ := doJSON(t, http.MethodGet, base+"/api/me", adminToken); code != http.StatusOK {
		t.Fatalf("admin GET /api/me: status %d", code)
	}
	if err := credit.GrantAdmin(context.Background(), plainID, 70, "comp"); err != nil {
		t.Fatalf("GrantAdmin: %v", err)
	}

	emails := func(query string) []string {
		t.Helper()
		code, body := doJSON(t, http.MethodGet, base+"/api/admin/users?"+query, adminToken)
		if code != http.StatusOK {
			t.Fatalf("list %s: status %d body %v", query, code, body)
		}
		var out []string
		for _, u := range body["users"].([]any) {
			m := u.(map[string]any)
			if m["createdAt"] == nil {
				t.Fatalf("list %s: createdAt missing on %v", query, m)
			}
			out = append(out, m["email"].(string))
		}
		return out
	}

	if got := strings.Join(emails("sort=created"), ","); got != "admin@example.com,plain@example.com" {
		t.Errorf("sort=created: %s, want the newer admin first", got)
	}
	if got := strings.Join(emails("sort=balance"), ","); got != "plain@example.com,admin@example.com" {
		t.Errorf("sort=balance: %s, want plain (70) first", got)
	}
	if got := emails("q=%25"); len(got) != 0 {
		t.Errorf("q=%%: %v, want none (%% matches literally)", got)
	}
	if got := strings.Join(emails("limit=1&offset=1"), ","); got != "plain@example.com" {
		t.Errorf("limit=1&offset=1: %s, want the second newest", got)
	}
}

func TestE2E_AdminUsers_BadRequestsAndUnknownUser(t *testing.T) {
	base, adminToken, _ := adminDictEnv(t)

	for _, tc := range []struct {
		path string
		want int
	}{
		{"/api/admin/users?sort=email", http.StatusBadRequest},
		{"/api/admin/users?limit=abc", http.StatusBadRequest},
		{"/api/admin/users/no-such-user", http.StatusNotFound},
		{"/api/admin/users/no-such-user/transactions", http.StatusNotFound},
		{"/api/admin/users/no-such-user/transactions?before=not-a-cursor", http.StatusNotFound},
	} {
		if code, body := doJSON(t, http.MethodGet, base+tc.path, adminToken); code != tc.want {
			t.Errorf("GET %s: status %d (%v), want %d", tc.path, code, body, tc.want)
		}
	}
}
