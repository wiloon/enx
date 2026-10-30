//go:build integration

package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"enx-api/billing/acceptance"
	"enx-api/billing/checkoutcompleted"
	"enx-api/billing/credit"
	"enx-api/billing/invoicepaid"
	billingstripe "enx-api/billing/stripe"
	"enx-api/billing/webhookevent"
	"enx-api/clerktest"
	"enx-api/config"
	"enx-api/enx"
	"enx-api/metrics"
	"enx-api/referral"
	referraladapters "enx-api/referral/adapters"
	"enx-api/repo"
	"enx-api/utils/sqlitex"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	stripeSDK "github.com/stripe/stripe-go/v86"
	"github.com/stripe/stripe-go/v86/webhook"
	"gorm.io/gorm"
)

func deletionGrantWriters() map[string]func() error {
	return map[string]func() error{
		"admin": func() error { return credit.GrantAdmin(context.Background(), "target", 10, "test") },
		"subscription": func() error {
			return credit.GrantSubscription(context.Background(), "target", 10, time.Now(), "evt_sub", "pi_sub")
		},
		"topup": func() error { return credit.GrantTopup(context.Background(), "target", 10, "evt_topup", "pi_topup") },
		"trial": func() error {
			_, err := credit.GrantTrial(context.Background(), "target", "h:target", 10, time.Hour)
			return err
		},
		"invitee with trial backfill": func() error {
			_, err := credit.GrantReferralBonus(context.Background(), "target", credit.ReferralBonus{Amount: 10, ExpiresAt: time.Now().Add(time.Hour), TrialAmount: 10, TrialTTL: time.Hour, EmailHMAC: "h:target"})
			return err
		},
		"referrer": func() error {
			return credit.GrantReferralReward(context.Background(), "target", 10, "referral-reward:invitee")
		},
	}
}

func TestDeletionBarrierStopsEveryGrantWriter(t *testing.T) {
	for name, grant := range deletionGrantWriters() {
		t.Run(name, func(t *testing.T) {
			start, request := deletionRecoveryEnv(t)
			entered, resume := make(chan struct{}), make(chan struct{})
			defer resumeDeletion(resume)
			start(deletionClerk{remove: func() error { close(entered); <-resume; return nil }})
			result := make(chan int, 1)
			go func() { code, _ := request(false, ""); result <- code }()
			<-entered
			if err := grant(); err == nil {
				t.Error("grant succeeded while deletion was in progress")
			}
			deletionCount(t, "SELECT count(*) FROM trial_grants WHERE email_hmac = 'h:target'", 0)
			deletionCount(t, "SELECT count(*) FROM credit_accounts WHERE user_id = 'target'", 0)
			deletionCount(t, "SELECT count(*) FROM credit_transactions WHERE user_id = 'target'", 0)
			close(resume)
			if code := <-result; code != 200 {
				t.Fatalf("deletion: %d", code)
			}
			if err := grant(); !errors.Is(err, credit.ErrNoUser) {
				t.Errorf("grant after deletion = %v, want ErrNoUser", err)
			}
			deletionCount(t, "SELECT count(*) FROM credit_accounts WHERE user_id = 'target'", 0)
			deletionCount(t, "SELECT count(*) FROM credit_transactions WHERE user_id = 'target'", 0)
			deletionCount(t, "SELECT count(*) FROM account_deletion_gates WHERE user_id = 'target' AND state = 'deleted'", 1)
			deletionSQL(t, "DELETE FROM account_deletion_gates WHERE user_id = 'target'")
			if err := grant(); !errors.Is(err, credit.ErrNoUser) {
				t.Errorf("grant to missing identity without gate = %v", err)
			}
		})
	}
}

func TestAdminGrantReportsRetryableDeletionBarrier(t *testing.T) {
	start, request := deletionRecoveryEnv(t)
	entered, resume := make(chan struct{}), make(chan struct{})
	defer resumeDeletion(resume)
	start(deletionClerk{remove: func() error { close(entered); <-resume; return nil }})
	result := make(chan int, 1)
	go func() { code, _ := request(false, ""); result <- code }()
	<-entered
	jwks := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = jwks.Config()
	cfg.Admin.ClerkUserIDs = []string{adminSub}

	server := httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), nil, nil))
	defer server.Close()
	token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": adminSub, "email": "admin@example.com"})
	code, body := doJSONBody(t, http.MethodPost, server.URL+"/api/admin/credits/grant", token, map[string]any{"userId": "target", "amount": 10, "reason": "support"})
	if code != 503 || body["code"] != "deletion_in_progress" || body["success"] != false {
		t.Errorf("blocked admin grant: %d %v", code, body)
	}
	close(resume)
	if code := <-result; code != 200 {
		t.Fatalf("deletion: %d", code)
	}
	deletionCount(t, "SELECT count(*) FROM credit_accounts WHERE user_id = 'target'", 0)
}

// This adapter only supplies the worker's dispatch signature; the decision
// and effects are the production checkout handler and repositories.
type deletionCheckoutWorker struct{ handler *checkoutcompleted.Handler }

func (h deletionCheckoutWorker) Handle(ctx context.Context, _ webhookevent.Kind, task webhookevent.StoredTask) webhookevent.Result {
	return h.handler.Handle(ctx, task)
}

type deletionRewardPayment struct{ beforeGrant func() }

func (deletionRewardPayment) InvoicePaymentIntent(context.Context, string) (string, error) {
	return "", errors.New("unexpected invoice lookup")
}
func (p deletionRewardPayment) Charge(context.Context, string) (referral.ChargeState, error) {
	if p.beforeGrant != nil {
		p.beforeGrant()
	}
	return referral.ChargeState{}, nil
}

func TestPaymentAndReferralWaitForDurableDeletionOutcome(t *testing.T) {
	for _, abort := range []bool{true, false} {
		t.Run(fmt.Sprintf("abort=%v", abort), func(t *testing.T) {
			entered, resume := make(chan struct{}), make(chan struct{})
			defer resumeDeletion(resume)
			stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				close(entered)
				<-resume
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"sub_live","status":"active"}`))
			}))
			defer stripeServer.Close()
			defer resumeDeletion(resume)
			backend := stripeSDK.GetBackendWithConfig(stripeSDK.APIBackend, &stripeSDK.BackendConfig{URL: stripeSDK.String(stripeServer.URL), HTTPClient: stripeServer.Client()})
			start, request := deletionRecoveryEnv(t, stripeSDK.NewClient("sk_test", stripeSDK.WithBackends(&stripeSDK.Backends{API: backend})))
			if abort {
				deletionSQL(t, "INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES ('sub_live', 'target', 'active', 'cus_1', 1, 1)")
				start((&fakeClerkBackend{}).client(t))
			} else {
				start(deletionClerk{remove: func() error { close(entered); <-resume; return nil }})
			}
			ctx := context.Background()
			at := time.Now()
			deletionSQL(t, "INSERT INTO users (id, clerk_user_id, email) VALUES ('invitee', 'user_invitee', 'invitee@example.com')")
			refs := repo.Referrals{}
			if _, err := refs.Insert(ctx, referral.Referral{InviteeID: "invitee", ReferrerID: "target", Code: "AAAAAAAA", ClaimedAt: at.Add(-time.Hour), Status: referral.StatusClaimed}); err != nil {
				t.Fatal(err)
			}
			if _, err := refs.RecordFirstPayment(ctx, "invitee", referral.FirstPayment{Kind: referral.KindTopup, PaymentIntentID: "pi_invitee", Credits: 100, PaidAt: at.Add(-time.Hour)}, referral.Reward{Status: referral.StatusPending, Amount: 10, DueAt: at.Add(-time.Minute)}); err != nil {
				t.Fatal(err)
			}
			result := make(chan int, 1)
			// Start deletion after the referral caller's existence lookup, so that
			// the ledger must independently recheck the target in its transaction.
			payments := deletionRewardPayment{beforeGrant: func() { go func() { code, _ := request(false, ""); result <- code }(); <-entered }}
			rewards := func(p deletionRewardPayment) referral.RewardRun {
				svc := referral.NewService(repo.ReferralCodes{}, refs, repo.ReferralAccounts{}, referraladapters.Ledger{}, p, func() time.Time { return at }, referral.FixedPolicy{})
				run, err := svc.PayDueRewards(ctx)
				if err != nil {
					t.Fatal(err)
				}
				return run
			}
			if run := rewards(payments); run.Retry != 1 || run.Rewarded != 0 || run.Forfeited != 0 {
				t.Fatalf("in-progress referral: %+v", run)
			}
			row, _, err := refs.Get(ctx, "invitee")
			if err != nil || row.Status != referral.StatusPending {
				t.Fatalf("pending referral: %+v %v", row, err)
			}
			endpoint := webhookevent.Endpoint{AccountID: "acct_test"}
			payload := []byte(`{"id":"evt_payment","object":"event","type":"checkout.session.completed","created":1790000000,"api_version":"2026-08-26.dahlia","livemode":false,"data":{"object":{"id":"cs_payment","object":"checkout.session","mode":"payment","client_reference_id":"target","customer":"cus_payment","payment_intent":"pi_payment","payment_status":"paid","metadata":{"type":"topup","tier":"small"}}}}`)
			signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: "whsec_test"})
			receiver := webhookevent.NewReceiver(func(p []byte, sig string) error { return billingstripe.VerifyWebhook(p, sig, "whsec_test") }, func() webhookevent.Endpoint { return endpoint }, repo.WebhookReceipts{}, func() time.Time { return at }, uuid.NewString)
			for range 2 {
				if outcome := receiver.Receive(ctx, signed.Payload, signed.Header); !outcome.Accepted {
					t.Fatalf("receipt: %+v", outcome)
				}
			}
			store := repo.NewWebhookEvents(repo.WebhookEffects{Now: func() time.Time { return at }, Referral: referral.FixedPolicy{}}.Apply)
			worker := webhookevent.NewWorker(store, deletionCheckoutWorker{checkoutcompleted.NewHandler(repo.CheckoutCompleted{Endpoint: endpoint}, map[string]int64{"small": 100})}, webhookevent.WorkerSettings{Timeout: time.Second, Lease: time.Minute, BackoffMin: time.Second, BackoffMax: time.Minute, DependencyWaitDeadline: time.Hour}, func() time.Time { return at }, uuid.NewString)
			if report, err := worker.Pass(ctx); err != nil || report.Waiting != 1 {
				t.Fatalf("in-progress payment: %+v %v", report, err)
			}
			deletionCount(t, "SELECT count(*) FROM credit_accounts WHERE user_id = 'target'", 0)
			close(resume)
			want := 200
			if abort {
				want = 409
			}
			if code := <-result; code != want {
				t.Fatalf("deletion %d, want %d", code, want)
			}
			at = at.Add(2 * time.Minute)
			report, err := worker.Pass(ctx)
			if err != nil {
				t.Fatal(err)
			}
			run := rewards(deletionRewardPayment{})
			if abort {
				if report.Processed != 1 || run.Rewarded != 1 {
					t.Fatalf("after abort: %+v %+v", report, run)
				}
				deletionCount(t, "SELECT count(*) FROM credit_transactions WHERE user_id = 'target'", 2)
			} else {
				if report.NeedsAttention != 1 || run.Forfeited != 1 {
					t.Fatalf("after deletion: %+v %+v", report, run)
				}
				row, _, err := refs.Get(ctx, "invitee")
				if err != nil || row.ForfeitReason != "referrer_deleted" {
					t.Fatalf("forfeit: %+v %v", row, err)
				}
				deletionCount(t, "SELECT count(*) FROM stripe_webhook_events WHERE status = 'needs_attention' AND last_error = 'payment_after_account_deletion' AND alert_state = 'pending'", 1)
				deletionCount(t, "SELECT count(*) FROM credit_accounts WHERE user_id = 'target'", 0)
				deletionCount(t, "SELECT count(*) FROM credit_transactions WHERE user_id = 'target'", 0)
				deletionCount(t, "SELECT count(*) FROM users WHERE id = 'target'", 0)
			}
			deletionCount(t, "SELECT count(*) FROM stripe_webhook_deliveries WHERE event_id = 'evt_payment'", 2)
			deletionCount(t, "SELECT count(*) FROM stripe_customers WHERE user_id = 'target' AND stripe_customer_id = 'cus_payment'", 1)
		})
	}
}

func TestDeletionRejectsConcurrentAcceptanceAndClassification(t *testing.T) {
	start, request := deletionRecoveryEnv(t)
	entered, resume := make(chan struct{}), make(chan struct{})
	defer resumeDeletion(resume)
	start(deletionClerk{remove: func() error { close(entered); <-resume; return nil }})
	deletionSQL(t, "INSERT INTO subscriptions (stripe_subscription_id, user_id, status, stripe_customer_id, created_at, updated_at) VALUES ('sub_ended', 'target', 'canceled', 'cus_1', 1, 1)")
	result := make(chan int, 1)
	go func() { code, _ := request(false, ""); result <- code }()
	<-entered
	owner, err := (repo.InvoicePaid{}).Owner(context.Background(), "target")
	if err != nil {
		t.Fatal(err)
	}
	for _, classification := range []acceptance.Classification{acceptance.Accepted, acceptance.Conflict} {
		effects := invoicepaid.Effects{Observed: invoicepaid.Observed{OwnerUserID: "target", Revision: owner.Revision, SubscriptionID: "sub_ended", SubscriptionKnown: true, SubscriptionVersion: 1}, Classification: &invoicepaid.Classification{To: classification}}
		err := sqlitex.DB.Transaction(func(tx *gorm.DB) error {
			return (repo.WebhookEffects{Now: time.Now}).Apply(tx, webhookevent.Scope{AccountID: "acct_test", EventID: "evt_race"}, effects)
		})
		if !errors.Is(err, invoicepaid.ErrStale) {
			t.Errorf("classification %s: %v", classification, err)
		}
	}
	close(resume)
	if code := <-result; code != 200 {
		t.Fatalf("deletion %d", code)
	}
	deletionCount(t, "SELECT count(*) FROM subscriptions WHERE classification != 'unclassified' AND classification != ''", 0)
}

func TestGrantReplaysAfterDeletionDoNotRecreateBalance(t *testing.T) {
	for name, grant := range deletionGrantWriters() {
		if name == "admin" {
			continue
		} // Manual grants have no replay key.
		t.Run(name, func(t *testing.T) {
			start, request := deletionRecoveryEnv(t)
			start((&fakeClerkBackend{}).client(t))
			if err := grant(); err != nil {
				t.Fatal(err)
			}
			if code, body := request(true, ""); code != 200 {
				t.Fatalf("delete: %d %v", code, body)
			}
			if err := grant(); err != nil {
				t.Fatalf("replay: %v", err)
			}
			deletionCount(t, "SELECT count(*) FROM credit_accounts WHERE user_id = 'target'", 0)
			want := 1
			if name == "invitee with trial backfill" {
				want = 2
			}
			deletionCount(t, "SELECT count(*) FROM credit_transactions WHERE user_id = 'target'", want)
		})
	}
}

func TestAdminGrantCannotUseTargetLookedUpBeforeDeletion(t *testing.T) {
	start, request := deletionRecoveryEnv(t)
	entered, resume := make(chan struct{}), make(chan struct{})
	defer resumeDeletion(resume)
	start(deletionClerk{remove: func() error { close(entered); <-resume; return nil }})
	result := make(chan int, 1)
	go func() { code, _ := request(false, ""); result <- code }()
	<-entered
	// Finish deletion immediately after the handler resolved its target.
	// The stale target is real; the grant transaction must check it again.
	observed := false
	if err := sqlitex.DB.Callback().Query().After("gorm:query").Register("test:delete_grant_target", func(tx *gorm.DB) {
		if u, ok := tx.Statement.Dest.(*enx.User); ok && u.Id == "target" && !observed {
			observed = true
			close(resume)
			if code := <-result; code != 200 {
				t.Errorf("delete: %d", code)
			}
		}
	}); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := sqlitex.DB.Callback().Query().Remove("test:delete_grant_target"); err != nil {
			t.Errorf("remove query callback: %v", err)
		}
	}()
	jwks := clerktest.NewEnv(t)
	cfg := config.Default()
	cfg.Clerk = jwks.Config()
	cfg.Admin.ClerkUserIDs = []string{adminSub}

	server := httptest.NewServer(setupRouterWithClients(cfg, metrics.New(), nil, nil))
	defer server.Close()
	token := jwks.SignSessionToken(t, jwt.MapClaims{"sub": adminSub, "email": "admin@example.com"})
	code, body := doJSONBody(t, http.MethodPost, server.URL+"/api/admin/credits/grant", token, map[string]any{"userId": "target", "amount": 10, "reason": "support"})
	if !observed || code != 404 || body["success"] != false {
		t.Fatalf("stale target: observed=%v %d %v", observed, code, body)
	}
	deletionCount(t, "SELECT count(*) FROM credit_accounts WHERE user_id = 'target'", 0)
	deletionCount(t, "SELECT count(*) FROM credit_transactions WHERE user_id = 'target'", 0)
}

func TestDeletedReferrerKeepsAlreadyGrantedLedgerPrecedence(t *testing.T) {
	start, request := deletionRecoveryEnv(t)
	start((&fakeClerkBackend{}).client(t))
	ctx := context.Background()
	at := time.Now()
	refs := repo.Referrals{}
	if _, err := refs.Insert(ctx, referral.Referral{InviteeID: "invitee", ReferrerID: "target", Code: "AAAAAAAA", ClaimedAt: at.Add(-time.Hour), Status: referral.StatusClaimed}); err != nil {
		t.Fatal(err)
	}
	if _, err := refs.RecordFirstPayment(ctx, "invitee", referral.FirstPayment{Kind: referral.KindTopup, PaymentIntentID: "pi_invitee", Credits: 100, PaidAt: at.Add(-time.Hour)}, referral.Reward{Status: referral.StatusPending, Amount: 10, DueAt: at.Add(-time.Minute)}); err != nil {
		t.Fatal(err)
	}
	// Model a crash after the ledger commit but before MarkRewarded.
	if err := credit.GrantReferralReward(ctx, "target", 10, "referral-reward:invitee"); err != nil {
		t.Fatal(err)
	}
	if code, body := request(true, ""); code != 200 {
		t.Fatalf("delete %d %v", code, body)
	}
	svc := referral.NewService(repo.ReferralCodes{}, refs, repo.ReferralAccounts{}, referraladapters.Ledger{}, deletionRewardPayment{beforeGrant: func() { t.Error("already granted reward consulted Stripe") }}, func() time.Time { return at }, referral.FixedPolicy{})
	run, err := svc.PayDueRewards(ctx)
	if err != nil || run.Rewarded != 1 || run.Forfeited != 0 || run.Retry != 0 {
		t.Fatalf("reconcile: %+v %v", run, err)
	}
	row, _, err := refs.Get(ctx, "invitee")
	if err != nil || row.Status != referral.StatusRewarded {
		t.Fatalf("referral: %+v %v", row, err)
	}
	deletionCount(t, "SELECT count(*) FROM credit_accounts WHERE user_id = 'target'", 0)
	deletionCount(t, "SELECT count(*) FROM credit_transactions WHERE user_id = 'target' AND type = 'GRANT_REFERRAL_REWARD'", 1)
}
