//go:build integration

package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"enx-api/billing/alert"
	"enx-api/utils/sqlitex"
)

type recordingMailer struct {
	mu    sync.Mutex
	mails []alert.Mail
}

func TestMountedPlanChangeHandsTheSmallestBlockingConflictToSupport(t *testing.T) {
	r := newRig(t, "topup-only.sql")
	if err := sqlitex.DB.AutoMigrate(&sqlitex.Referral{}); err != nil {
		t.Fatal(err)
	}
	r.stripe.portalSafe.Store(true)
	r.start(t)
	eventually(t, "endpoint discovery", func() bool { return r.a.identity.Endpoint().AccountID != "" })
	process := func(id, kind, object string) {
		t.Helper()
		if code := r.deliver(t, id, kind, object); code != http.StatusOK {
			t.Fatalf("%s receipt = %d, want 200", id, code)
		}
		r.tickers.tick(testPoll)
		eventually(t, id+" processing", func() bool {
			status, _ := eventStatus(t, id)
			return status == "processed"
		})
	}
	// Create the larger conflict first: selection must follow the ID,
	// rather than discovery order or the accepted subscription pointer.
	for _, sub := range []string{"sub_recovery", "sub_conflict_a", "sub_conflict"} {
		process("evt_checkout_"+sub, "checkout.session.completed", `{"object":"checkout.session","id":"cs_`+sub+`","mode":"subscription","client_reference_id":"u_topup","customer":"cus_topup","subscription":"`+sub+`","payment_status":"paid"}`)
		invoice := strings.NewReplacer("sub_recovery", sub, "in_checkout", "in_"+sub).Replace(paidInvoice)
		process("evt_invoice_"+sub, "invoice.paid", invoice)
	}
	post := func(path, user, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-User", user)
		rec := httptest.NewRecorder()
		r.router.ServeHTTP(rec, req)
		return rec
	}
	rec := post("/api/billing/portal/plan-change", "u_topup", `{"tier":"max"}`)
	var blocked struct {
		Success        bool
		Reason         string
		SubscriptionID string `json:"subscriptionId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &blocked); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusConflict || blocked.Success || blocked.Reason != "subscription_conflict" || blocked.SubscriptionID != "sub_conflict" {
		t.Fatalf("plan change = %d: %s, want 409 naming sub_conflict", rec.Code, rec.Body.String())
	}
	if n := r.stripe.sessionsMade.Load(); n != 0 {
		t.Fatalf("blocked plan change created %d Stripe sessions", n)
	}
	body := `{"subscriptionId":"` + blocked.SubscriptionID + `","message":"Please help with my subscriptions."}`
	// The support edge independently checks ownership and classification.
	if rec := post("/api/billing/support", "another_user", body); rec.Code != http.StatusNotFound {
		t.Fatalf("another user's support request = %d: %s", rec.Code, rec.Body.String())
	}
	if rec := post("/api/billing/support", "u_topup", `{"subscriptionId":"sub_recovery","message":"Help"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("accepted subscription support = %d: %s", rec.Code, rec.Body.String())
	}
	rec = post("/api/billing/support", "u_topup", body)
	var support struct {
		Success bool
		Request struct {
			Message string
			SentAt  string
		} `json:"supportRequest"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &support); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || !support.Success || support.Request.Message != "Please help with my subscriptions." || support.Request.SentAt == "" {
		t.Fatalf("support handoff = %d: %s", rec.Code, rec.Body.String())
	}
	var saved struct {
		Message string
		State   string
	}
	if err := sqlitex.DB.Raw("SELECT support_message AS message, support_alert_state AS state FROM subscriptions WHERE stripe_subscription_id = ?", blocked.SubscriptionID).Scan(&saved).Error; err != nil {
		t.Fatal(err)
	}
	if saved.Message != support.Request.Message || saved.State != "pending" {
		t.Fatalf("persisted support = %+v, want submitted message and pending alert", saved)
	}
}

func (m *recordingMailer) SendAdminAlert(_ context.Context, subject, text string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.mails = append(m.mails, alert.Mail{Subject: subject, Text: text})
	return nil
}

func TestMountedSecondLiveSubscriptionKeepsAcceptedCreditsAndSendsOneConflictAlert(t *testing.T) {
	mailer := &recordingMailer{}
	// Unbuffered ticks let the next send wait until the previous notifier
	// pass has finished, so repeated-pass assertions need no sleeps.
	notify := make(chan time.Time)
	r := newRigWithDeps(t, func(d *Deps) {
		d.Mailer = mailer
		ticker := d.Ticker
		d.Ticker = func(interval time.Duration) (<-chan time.Time, func()) {
			if interval == testNotifyPoll {
				return notify, func() {}
			}
			return ticker(interval)
		}
	}, "topup-only.sql")
	if err := sqlitex.DB.AutoMigrate(&sqlitex.Referral{}); err != nil {
		t.Fatal(err)
	}
	r.stripe.portalSafe.Store(true)
	r.start(t)
	eventually(t, "endpoint discovery", func() bool { return r.a.identity.Endpoint().AccountID != "" })
	process := func(id, kind, object string) {
		t.Helper()
		if code := r.deliver(t, id, kind, object); code != http.StatusOK {
			t.Fatalf("%s receipt = %d, want 200", id, code)
		}
		r.tickers.tick(testPoll)
		eventually(t, id+" processing", func() bool {
			status, _ := eventStatus(t, id)
			return status == "processed"
		})
	}
	process("evt_accepted_checkout", "checkout.session.completed", `{"object":"checkout.session","id":"cs_accepted","mode":"subscription","client_reference_id":"u_topup","customer":"cus_topup","subscription":"sub_recovery","payment_status":"paid"}`)
	process("evt_accepted_invoice", "invoice.paid", paidInvoice)
	assertPaymentState(t, "sub_recovery", 5000, 1)
	process("evt_conflict_checkout", "checkout.session.completed", `{"object":"checkout.session","id":"cs_conflict","mode":"subscription","client_reference_id":"u_topup","customer":"cus_topup","subscription":"sub_conflict","payment_status":"paid"}`)
	conflictInvoice := strings.NewReplacer("sub_recovery", "sub_conflict", "in_checkout", "in_conflict").Replace(paidInvoice)
	process("evt_conflict_invoice", "invoice.paid", conflictInvoice)
	assertPaymentState(t, "sub_recovery", 5000, 1)
	var grants int64
	if err := sqlitex.DB.Raw("SELECT count(*) FROM credit_transactions WHERE stripe_invoice_id = 'in_conflict'").Scan(&grants).Error; err != nil {
		t.Fatal(err)
	}
	if grants != 0 {
		t.Fatalf("conflict grants = %d, want 0", grants)
	}
	var owner string
	if err := sqlitex.DB.Raw("SELECT user_id FROM stripe_customers WHERE stripe_customer_id = 'cus_topup'").Scan(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if owner != "u_topup" {
		t.Fatalf("Customer owner = %q, want u_topup", owner)
	}
	req := httptest.NewRequest(http.MethodGet, alert.AdminSubscriptionConflictsPath, nil)
	req.Header.Set("X-User", "admin")
	req.Header.Set("X-Admin", "1")
	rec := httptest.NewRecorder()
	r.router.ServeHTTP(rec, req)
	var body struct {
		Success   bool
		Conflicts []struct {
			SubscriptionID string `json:"subscriptionId"`
			AcceptedID     string `json:"acceptedSubscriptionId"`
			UserID         string `json:"userId"`
			CustomerID     string `json:"customerId"`
			Status         string
		}
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || !body.Success || len(body.Conflicts) != 1 {
		t.Fatalf("admin conflicts = %d: %s", rec.Code, rec.Body.String())
	}
	cf := body.Conflicts[0]
	if cf.SubscriptionID != "sub_conflict" || cf.AcceptedID != "sub_recovery" || cf.UserID != "u_topup" || cf.CustomerID != "cus_topup" || cf.Status != "open" {
		t.Fatalf("admin conflict = %+v", cf)
	}
	// Replaying both the same event and another event for the rejected
	// invoice must neither grant credits nor raise another discovery alert.
	process("evt_conflict_invoice", "invoice.paid", conflictInvoice)
	process("evt_conflict_replay", "invoice.paid", conflictInvoice)
	for range 3 {
		select {
		case notify <- time.Now():
		case <-time.After(5 * time.Second):
			t.Fatal("notifier did not take a tick")
		}
	}
	r.cancel()
	select {
	case <-r.a.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("assembly did not stop")
	}
	if len(mailer.mails) != 1 {
		t.Fatalf("mails = %+v, want exactly one conflict alert", mailer.mails)
	}
	var sent struct {
		State    string
		Attempts int
	}
	if err := sqlitex.DB.Raw("SELECT conflict_alert_state AS state, conflict_alert_attempts AS attempts FROM subscriptions WHERE stripe_subscription_id = 'sub_conflict'").Scan(&sent).Error; err != nil {
		t.Fatal(err)
	}
	if sent.State != "sent" || sent.Attempts != 1 {
		t.Fatalf("persisted conflict alert = %+v, want sent/1", sent)
	}
	mail := mailer.mails[0]
	if mail.Subject != "Catglish billing: subscription conflict sub_conflict" || !strings.Contains(mail.Text, "Accepted subscription: sub_recovery") || !strings.Contains(mail.Text, "GET "+alert.AdminSubscriptionConflictsPath+"/sub_conflict") {
		t.Fatalf("conflict mail = %+v", mail)
	}
	assertPaymentState(t, "sub_recovery", 5000, 1)
	if n := countRows(t, "credit_transactions"); n != 2 {
		t.Fatalf("ledger rows = %d, want the legacy top-up and accepted invoice only", n)
	}
}

func TestMountedAdminDetailResolveAndRetryServeAnAdminAndRefuseAnyoneElse(t *testing.T) {
	r := newRig(t, "topup-only.sql")
	if err := sqlitex.DB.AutoMigrate(&sqlitex.Referral{}); err != nil {
		t.Fatal(err)
	}
	r.stripe.portalSafe.Store(true)
	r.start(t)
	eventually(t, "endpoint discovery", func() bool { return r.a.identity.Endpoint().AccountID != "" })
	process := func(id, kind, object string) {
		t.Helper()
		if code := r.deliver(t, id, kind, object); code != http.StatusOK {
			t.Fatalf("%s receipt = %d, want 200", id, code)
		}
		r.tickers.tick(testPoll)
		eventually(t, id+" processing", func() bool {
			status, _ := eventStatus(t, id)
			return status == "processed"
		})
	}
	for _, sub := range []string{"sub_recovery", "sub_conflict"} {
		process("evt_checkout_"+sub, "checkout.session.completed", `{"object":"checkout.session","id":"cs_`+sub+`","mode":"subscription","client_reference_id":"u_topup","customer":"cus_topup","subscription":"`+sub+`","payment_status":"paid"}`)
		process("evt_invoice_"+sub, "invoice.paid", strings.NewReplacer("sub_recovery", sub, "in_checkout", "in_"+sub).Replace(paidInvoice))
	}
	do := func(method, path, body string, admin bool) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-User", "operator")
		if admin {
			req.Header.Set("X-Admin", "1")
		}
		rec := httptest.NewRecorder()
		r.router.ServeHTTP(rec, req)
		return rec
	}
	conflictPath := alert.AdminSubscriptionConflictsPath + "/sub_conflict"
	eventPath := alert.AdminWebhookEventsPath + "/evt_invoice_sub_conflict"

	// A processed event cannot be retried; park it as needing attention.
	if err := sqlitex.DB.Exec("UPDATE stripe_webhook_events SET status = 'needs_attention' WHERE event_id = 'evt_invoice_sub_conflict'").Error; err != nil {
		t.Fatal(err)
	}
	// Every method and path is refused to a non-admin before any handler runs.
	resolveBody := `{"status":"resolved","notes":"Cancelled the duplicate in Stripe."}`
	for _, c := range []struct{ method, path, body string }{
		{http.MethodGet, conflictPath, ""},
		{http.MethodPatch, conflictPath, resolveBody},
		{http.MethodGet, eventPath, ""},
		{http.MethodPost, eventPath + "/retry", ""},
	} {
		if rec := do(c.method, c.path, c.body, false); rec.Code != http.StatusForbidden {
			t.Errorf("%s %s as non-admin = %d, want 403", c.method, c.path, rec.Code)
		}
	}
	if status, _ := eventStatus(t, "evt_invoice_sub_conflict"); status != "needs_attention" {
		t.Fatalf("a refused retry changed the event to %q", status)
	}

	rec := do(http.MethodGet, conflictPath, "", true)
	var detail struct {
		Success  bool
		Conflict struct {
			SubscriptionID string `json:"subscriptionId"`
			Status         string
		}
		Events []struct {
			EventID string `json:"eventId"`
		}
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || !detail.Success || detail.Conflict.SubscriptionID != "sub_conflict" || detail.Conflict.Status != "open" || len(detail.Events) == 0 {
		t.Fatalf("conflict detail = %d: %s", rec.Code, rec.Body.String())
	}

	var resolved struct {
		Success    bool
		Resolution struct {
			Status     string
			ResolvedBy string `json:"resolvedBy"`
			Notes      string
		}
	}
	for range 2 { // repeating the same resolution is a no-op
		rec = do(http.MethodPatch, conflictPath, resolveBody, true)
		if err := json.Unmarshal(rec.Body.Bytes(), &resolved); err != nil {
			t.Fatal(err)
		}
		if rec.Code != http.StatusOK || !resolved.Success || resolved.Resolution.Status != "resolved" || resolved.Resolution.ResolvedBy != "operator" || resolved.Resolution.Notes != "Cancelled the duplicate in Stripe." {
			t.Fatalf("resolve = %d: %s", rec.Code, rec.Body.String())
		}
	}
	if rec = do(http.MethodPatch, conflictPath, `{"status":"resolved","notes":"Other notes"}`, true); rec.Code != http.StatusConflict {
		t.Fatalf("resolve with different notes = %d: %s", rec.Code, rec.Body.String())
	}

	rec = do(http.MethodGet, eventPath, "", true)
	var event struct {
		Success bool
		Event   struct {
			EventID string `json:"eventId"`
			Status  string
		}
		Deliveries []struct{ ID string }
		Payload    struct{ ID string }
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &event); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || !event.Success || event.Event.EventID != "evt_invoice_sub_conflict" || event.Event.Status != "needs_attention" || len(event.Deliveries) != 1 || event.Payload.ID != "evt_invoice_sub_conflict" {
		t.Fatalf("event detail = %d: %s", rec.Code, rec.Body.String())
	}

	rec = do(http.MethodPost, eventPath+"/retry", "", true)
	if err := json.Unmarshal(rec.Body.Bytes(), &event); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || !event.Success || event.Event.Status != "pending" {
		t.Fatalf("retry = %d: %s", rec.Code, rec.Body.String())
	}
	if status, _ := eventStatus(t, "evt_invoice_sub_conflict"); status != "pending" {
		t.Fatalf("persisted status after retry = %q, want pending", status)
	}
	// Only an event that needs attention can be retried.
	if rec = do(http.MethodPost, eventPath+"/retry", "", true); rec.Code != http.StatusConflict {
		t.Fatalf("second retry = %d: %s", rec.Code, rec.Body.String())
	}
}
