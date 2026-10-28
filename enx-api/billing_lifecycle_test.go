package main

import (
	"context"
	billingapp "enx-api/billing/app"
	"enx-api/email"
	"testing"
	"time"

	"github.com/google/uuid"
)

type testBillingAssembly struct {
	done   chan struct{}
	starts int
}

func (a *testBillingAssembly) Start(ctx context.Context) error {
	a.starts++
	go func() { <-ctx.Done(); close(a.done) }()
	return nil
}
func (a *testBillingAssembly) Done() <-chan struct{} { return a.done }

func TestBillingLifecycleCancelsAndWaitsForAssembly(t *testing.T) {
	a := &testBillingAssembly{done: make(chan struct{})}
	lifecycle, err := startBillingLifecycle(context.Background(), a)
	if err != nil {
		t.Fatal(err)
	}
	if a.starts != 1 {
		t.Fatalf("started %d times", a.starts)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := lifecycle.stop(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-a.done:
	default:
		t.Fatal("assembly still running")
	}
}

func TestBillingLifecycleStopsWaitingAtDeadline(t *testing.T) {
	a := &testBillingAssembly{done: make(chan struct{})}
	lifecycle := &billingLifecycle{cancel: func() {}, done: a.done}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := lifecycle.stop(ctx); err != context.Canceled {
		t.Fatalf("got %v, want context cancellation", err)
	}
}

func TestBillingLifecycleUsesApplicationContextAndRealAssemblyRejectsSecondStart(t *testing.T) {
	restoreBillingDatabase(t)
	cfg := billingStartupConfig(t)
	if err := openBillingDatabase(t, func() error { return initializeBillingDatabase(cfg.DB.Path, "error", true) }); err != nil {
		t.Fatal(err)
	}
	assembly, err := billingapp.New(billingapp.Deps{
		Stripe: cfg.Stripe, PortalReturnURL: cfg.App.FrontendBaseURL + "/billing",
		Referral: newReferralPolicy(cfg), Client: startupStripeClient(t), Mailer: email.NewSender(cfg.Resend),
		Now: time.Now, NewToken: uuid.NewString,
	})
	if err != nil {
		t.Fatal(err)
	}
	parent, cancel := context.WithCancel(context.Background())
	defer cancel()
	lifecycle, err := startBillingLifecycle(parent, assembly)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		deadline, stop := context.WithTimeout(context.Background(), time.Second)
		defer stop()
		if err := lifecycle.stop(deadline); err != nil {
			t.Error(err)
		}
	})
	if second, err := startBillingLifecycle(parent, assembly); err == nil || second != nil {
		t.Fatalf("second Start = %v, %v", second, err)
	}
	cancel()
	select {
	case <-assembly.Done():
	case <-time.After(time.Second):
		t.Fatal("real billing assembly ignored application cancellation")
	}
}
