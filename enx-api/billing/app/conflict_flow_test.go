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
