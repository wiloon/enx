package main

import (
	"context"
	"enx-api/billing/app"
	"enx-api/config"
	"enx-api/email"
	"enx-api/metrics"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	stripeSDK "github.com/stripe/stripe-go/v86"
)

// application owns the HTTP router and the billing workers sharing its lifetime.
type application struct {
	router  *gin.Engine
	billing *billingLifecycle
}

// initializeApplication is the production startup seam. Database preparation
// precedes route construction and every billing background job.
func initializeApplication(ctx context.Context, cfg *config.Config, m *metrics.Metrics, sc *stripeSDK.Client) (*application, error) {
	if err := initializeBillingDatabase(cfg.DB.Path, cfg.Log.Level, cfg.Billing.Cutover); err != nil {
		return nil, err
	}
	if err := m.InstrumentDB(sqlitex.DB); err != nil {
		// Losing the busy counter must not stop the API.
		logger.Errorf("metrics: sqlite instrumentation: %v", err)
	}
	var assembly *app.Assembly
	if cfg.Billing.Cutover {
		var err error
		assembly, err = app.New(app.Deps{
			Stripe: cfg.Stripe, PortalReturnURL: cfg.App.FrontendBaseURL + "/billing",
			Referral: newReferralPolicy(cfg), Client: sc, Mailer: email.NewSender(cfg.Resend),
			Now: time.Now, NewToken: uuid.NewString, Webhooks: m,
		})
		if err != nil {
			return nil, err
		}
	}
	a := &application{router: setupRouterWithBilling(cfg, m, sc, clerkBackend(cfg.Clerk), assembly)}
	if assembly != nil {
		lifecycle, err := startBillingLifecycle(ctx, assembly)
		if err != nil {
			return nil, err
		}
		a.billing = lifecycle
	}
	return a, nil
}

func (a *application) stopBilling(ctx context.Context) error {
	if a.billing == nil {
		return nil
	}
	return a.billing.stop(ctx)
}

// serve joins billing cleanup before returning, both on cancellation and on
// a listener error. HTTP draining and billing share one shutdown deadline.
func (a *application) serve(ctx context.Context, srv *http.Server) error {
	listening := make(chan error, 1)
	go func() { listening <- srv.ListenAndServe() }()
	var listenErr error
	select {
	case listenErr = <-listening:
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), srv.WriteTimeout+shutdownGraceMargin)
	defer cancel()
	if a.billing != nil {
		a.billing.cancel()
	}
	httpErr := srv.Shutdown(shutdownCtx)
	billingErr := a.stopBilling(shutdownCtx)
	if errors.Is(listenErr, http.ErrServerClosed) {
		listenErr = nil
	}
	return errors.Join(listenErr, httpErr, billingErr)
}
