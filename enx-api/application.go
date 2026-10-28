package main

import (
	"context"
	"enx-api/billing/app"
	"enx-api/config"
	"enx-api/email"
	"enx-api/metrics"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
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
