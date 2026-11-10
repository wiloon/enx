package server

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

// Application owns the HTTP router and the billing workers sharing its lifetime.
type Application struct {
	router  *gin.Engine
	billing *billingLifecycle
}

// Initialize is the production startup seam. Database preparation
// precedes route construction and every billing background job.
func Initialize(ctx context.Context, cfg *config.Config, m *metrics.Metrics, sc *stripeSDK.Client) (*Application, error) {
	if err := initializeBillingDatabase(cfg.DB.Path, cfg.Log.Level); err != nil {
		return nil, err
	}
	if err := m.InstrumentDB(sqlitex.DB); err != nil {
		// Losing the busy counter must not stop the API.
		logger.Errorf("metrics: sqlite instrumentation: %v", err)
	}
	assembly, err := app.New(app.Deps{
		Stripe: cfg.Stripe, PortalReturnURL: cfg.App.FrontendBaseURL + "/billing",
		Referral: newReferralPolicy(cfg), Client: sc, Mailer: email.NewSender(cfg.Resend), Now: time.Now, NewToken: uuid.NewString, Webhooks: m,
	})
	if err != nil {
		return nil, err
	}
	a := &Application{router: setupRouterWithBilling(cfg, m, sc, clerkBackend(cfg.Clerk), assembly)}
	if assembly != nil {
		lifecycle, err := startBillingLifecycle(ctx, assembly)
		if err != nil {
			return nil, err
		}
		a.billing = lifecycle
	}
	return a, nil
}

// Handler is the router that serves every HTTP route.
func (a *Application) Handler() http.Handler { return a.router }

func (a *Application) stopBilling(ctx context.Context) error {
	if a.billing == nil {
		return nil
	}
	return a.billing.stop(ctx)
}

// Serve joins billing cleanup before returning, both on cancellation and on
// a listener error. HTTP draining and billing share one shutdown deadline.
func (a *Application) Serve(ctx context.Context, srv *http.Server) error {
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
