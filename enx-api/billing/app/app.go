// Package app is the billing composition root (ADR-067): it assembles the
// durable webhook receipt, worker, notifier, legacy provenance backfill and
// the billing HTTP edges from their parts, and runs the remote startup
// sequence. It sits above billing and repo, so it may import both. Nothing
// calls it from main yet; the #297 cutover connects it.
package app

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"enx-api/billing"
	"enx-api/billing/alert"
	"enx-api/billing/billingsupport"
	"enx-api/billing/chargerefunded"
	"enx-api/billing/checkoutcompleted"
	"enx-api/billing/conflictadmin"
	"enx-api/billing/eventadmin"
	"enx-api/billing/invoicepaid"
	"enx-api/billing/legacyprovenance"
	"enx-api/billing/portalsession"
	"enx-api/billing/snapshot"
	billingstripe "enx-api/billing/stripe"
	"enx-api/billing/webhookdispatch"
	"enx-api/billing/webhookevent"
	"enx-api/config"
	"enx-api/referral"
	"enx-api/repo"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
	stripeSDK "github.com/stripe/stripe-go/v86"
)

// Ticker returns a channel that delivers a tick every d and a function that
// stops it. time.NewTicker in production; tests drive the channel by hand.
type Ticker func(d time.Duration) (<-chan time.Time, func())

// Deps are everything the assembly is built from. The database is the
// configured one behind package repo.
type Deps struct {
	// Stripe is the stripe.* configuration: secret key, webhook secret, Portal
	// overrides, lookup keys, credit amounts and the webhook timings.
	Stripe config.Stripe
	// PortalReturnURL is where a Portal session sends the user back to.
	PortalReturnURL string
	// Referral supplies the terms of the first-payment handoff.
	Referral referral.CreditPolicy
	// Client is the Stripe SDK client every remote call goes through.
	Client *stripeSDK.Client
	Mailer alert.Mailer
	Now    func() time.Time
	// NewToken returns a fresh, unique token on every call: claim tokens and
	// delivery IDs.
	NewToken func() string
	// Webhooks counts receipt outcomes; may be nil.
	Webhooks billing.WebhookObserver
	// Report gets every startup or loop failure with the name of its step.
	// Logged when nil.
	Report func(step string, err error)
	// Ticker defaults to time.NewTicker.
	Ticker Ticker
}

// Assembly is the wired billing subsystem.
type Assembly struct {
	ReceiptHandler           *billing.ReceiptHandler
	SupportHandler           *billing.SupportHandler
	PortalSessionHandler     *billing.PortalSessionHandler
	ConflictAdminHandler     *billing.ConflictAdminHandler
	WebhookEventAdminHandler *billing.WebhookEventAdminHandler

	deps     Deps
	identity *webhookevent.Identity
	store    repo.WebhookEvents
	portal   *billingstripe.PortalClient
	worker   *billingstripe.WorkerClient

	mu      sync.Mutex
	started bool
	wg      sync.WaitGroup
	done    chan struct{}
}

// New validates the local configuration and returns the assembly. It starts
// nothing: a misconfiguration is an error here, never a half-started
// assembly.
func New(d Deps) (*Assembly, error) {
	if err := validate(d); err != nil {
		return nil, err
	}
	if d.Report == nil {
		d.Report = func(step string, err error) { logger.Errorf("billing: %s: %v", step, err) }
	}
	if d.Ticker == nil {
		d.Ticker = func(interval time.Duration) (<-chan time.Time, func()) {
			t := time.NewTicker(interval)
			return t.C, t.Stop
		}
	}
	identity, err := webhookevent.NewIdentity(d.Stripe.SecretKey.Reveal())
	if err != nil {
		return nil, err
	}
	a := &Assembly{deps: d, identity: identity, worker: billingstripe.NewWorkerClient(d.Client), done: make(chan struct{})}
	// The dispatcher needs every handler; build it once without Prices so an
	// absent one fails here rather than at startup.
	if _, err := webhookdispatch.New(a.handlers(nil)); err != nil {
		return nil, err
	}

	secret := d.Stripe.WebhookSecret.Reveal()
	verify := func(payload []byte, sigHeader string) error {
		return billingstripe.VerifyWebhook(payload, sigHeader, secret)
	}
	receiver := webhookevent.NewReceiver(verify, identity.Endpoint, repo.WebhookReceipts{}, d.Now, d.NewToken)
	a.store = repo.NewWebhookEvents(repo.WebhookEffects{Referral: d.Referral, Now: d.Now}.Apply)
	a.portal = billingstripe.NewPortalClient(d.Client, d.Stripe.PortalConfigurationID,
		d.Stripe.PortalRestrictedConfigurationID, d.Stripe.Price.SubscriptionPlans())

	a.ReceiptHandler = billing.NewReceiptHandler(receiver, d.Webhooks)
	a.SupportHandler = billing.NewSupportHandler(billingsupport.New(repo.BillingSupport{}, d.Now))
	a.PortalSessionHandler = billing.NewPortalSessionHandler(portalsession.New(repo.PortalSessionOwners{}, a.portal, d.PortalReturnURL))
	a.ConflictAdminHandler = billing.NewConflictAdminHandler(conflictadmin.New(repo.SubscriptionConflicts{}, d.Now))
	a.WebhookEventAdminHandler = billing.NewWebhookEventAdminHandler(eventadmin.New(a.store, identity.Endpoint, d.Now))
	return a, nil
}

func validate(d Deps) error {
	var errs []error
	require := func(ok bool, what string) {
		if !ok {
			errs = append(errs, errors.New("billing/app: "+what))
		}
	}
	require(d.Client != nil, "no Stripe client")
	require(d.Mailer != nil, "no mailer")
	require(d.Referral != nil, "no referral terms")
	require(d.Now != nil, "no clock")
	require(d.NewToken != nil, "no token generator")
	require(d.Stripe.WebhookSecret.Reveal() != "", "no webhook signing secret")
	require(d.PortalReturnURL != "", "no Portal return URL")
	w := d.Stripe.Webhook
	for name, v := range map[string]time.Duration{
		"poll-interval": w.PollInterval, "lease-duration": w.LeaseDuration, "operation-timeout": w.OperationTimeout,
		"backoff-min": w.BackoffMin, "backoff-max": w.BackoffMax, "dependency-wait-deadline": w.DependencyWaitDeadline,
		"notification-poll-interval": w.NotificationPollInterval, "notification-timeout": w.NotificationTimeout,
		"notification-lease-duration": w.NotificationLeaseDuration,
	} {
		require(v > 0, "stripe.webhook."+name+" must be positive")
	}
	require(w.BackoffMin <= w.BackoffMax, "stripe.webhook.backoff-min must not exceed backoff-max")
	require(w.OperationTimeout < w.LeaseDuration, "stripe.webhook.operation-timeout must be shorter than lease-duration")
	require(w.NotificationTimeout < w.NotificationLeaseDuration, "stripe.webhook.notification-timeout must be shorter than notification-lease-duration")
	return errors.Join(errs...)
}

// topUpCredits is each top-up tier's credits.
func (a *Assembly) topUpCredits() map[string]int64 {
	c := a.deps.Stripe.Credits
	return map[string]int64{"small": c.TopupSmall, "medium": c.TopupMedium, "large": c.TopupLarge}
}

// planCredits is each subscription tier's per-period credits.
func (a *Assembly) planCredits() map[string]int64 {
	out := map[string]int64{}
	for tier := range a.deps.Stripe.Price.SubscriptionPlans() {
		out[tier] = a.deps.Stripe.Credits.Subscription(tier)
	}
	return out
}

// handlers are the decision services over the tier of each Price.
func (a *Assembly) handlers(tierForPrice map[string]string) webhookdispatch.Handlers {
	endpoint := a.endpoint()
	return webhookdispatch.Handlers{
		Checkout: checkoutcompleted.NewHandler(repo.CheckoutCompleted{Endpoint: endpoint}, a.topUpCredits()),
		InvoicePaid: invoicepaid.NewHandler(repo.InvoicePaid{}, a.worker,
			invoicepaid.Plans{TierForPrice: tierForPrice, Credits: a.planCredits()}, a.deps.Now),
		Refund:   chargerefunded.NewHandler(repo.ChargeRefunds{}, a.worker),
		Snapshot: snapshot.NewHandler(repo.SubscriptionSnapshots{}, a.worker, tierForPrice),
	}
}

func (a *Assembly) endpoint() webhookevent.Endpoint {
	if a.identity == nil {
		return webhookevent.Endpoint{}
	}
	return a.identity.Endpoint()
}

// Mount registers the routes on the supplied groups, which already carry
// their prefixes and middleware: root is the unprefixed router, api is
// /api behind authentication, admin is /api/admin behind authentication and
// the administrator check.
func (a *Assembly) Mount(api, admin, root gin.IRoutes) {
	root.POST("/billing/webhook", a.ReceiptHandler.Webhook)

	api.POST("/billing/support", a.SupportHandler.Submit)
	api.POST("/billing/portal", a.PortalSessionHandler.Home)
	api.POST("/billing/portal/plan-change", a.PortalSessionHandler.PlanChange)

	admin.GET("/subscription-conflicts", a.ConflictAdminHandler.List)
	admin.GET("/subscription-conflicts/:id", a.ConflictAdminHandler.Detail)
	admin.PATCH("/subscription-conflicts/:id", a.ConflictAdminHandler.Resolve)
	admin.GET("/webhook-events", a.WebhookEventAdminHandler.List)
	admin.GET("/webhook-events/:id", a.WebhookEventAdminHandler.Detail)
	admin.POST("/webhook-events/:id/retry", a.WebhookEventAdminHandler.Retry)
}

// Done is closed once every goroutine Start launched has stopped.
func (a *Assembly) Done() <-chan struct{} { return a.done }

// Start launches the startup sequence and the loops, bound to ctx, and
// returns at once without waiting for Stripe. Remote failures are reported
// with their step and retried on the worker poll interval. Call it once.
func (a *Assembly) Start(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.started {
		return errors.New("billing/app: already started")
	}
	a.started = true
	a.wg.Add(2)
	go func() { defer a.wg.Done(); a.runPipeline(ctx) }()
	go func() { defer a.wg.Done(); a.runNotifier(ctx) }()
	go func() { a.wg.Wait(); close(a.done) }()
	return nil
}

func (a *Assembly) runNotifier(ctx context.Context) {
	w := a.deps.Stripe.Webhook
	n := alert.NewNotifier(repo.Alerts{}, a.deps.Mailer, alert.NotifierSettings{
		Timeout: w.NotificationTimeout, Lease: w.NotificationLeaseDuration, RetryAfter: w.NotificationPollInterval,
	}, a.deps.Now, a.deps.NewToken)
	ticks, stop := a.deps.Ticker(w.NotificationPollInterval)
	defer stop()
	n.Run(ctx, ticks, func(_ alert.Report, err error) {
		if err != nil {
			a.deps.Report("alert notifier pass", err)
		}
	})
}

// runPipeline is the remote startup sequence followed by the worker loop.
func (a *Assembly) runPipeline(ctx context.Context) {
	w := a.deps.Stripe.Webhook
	retries, stop := a.deps.Ticker(w.PollInterval)
	defer stop()

	if err := a.identity.Discover(ctx, func(c context.Context) (string, error) {
		c, cancel := context.WithTimeout(c, w.OperationTimeout)
		defer cancel()
		return billingstripe.EndpointAccountID(c, a.deps.Client)
	}, retries, func(err error) { a.deps.Report("endpoint discovery", err) }); err != nil {
		return
	}

	tierPrices, ok := a.resolvePrices(ctx, retries)
	if !ok {
		return
	}
	a.checkPortal(ctx, tierPrices)

	tierForPrice := make(map[string]string, len(tierPrices))
	for tier, id := range tierPrices {
		tierForPrice[id] = tier
	}
	dispatcher, err := webhookdispatch.New(a.handlers(tierForPrice))
	if err != nil {
		a.deps.Report("webhook dispatcher", err)
		return
	}
	backfill := legacyprovenance.NewBackfill(repo.LegacyProvenance{}, billingstripe.NewBackfillClient(a.deps.Client))
	worker := webhookevent.NewWorker(a.store, dispatcher, webhookevent.WorkerSettings{
		Timeout: w.OperationTimeout, Lease: w.LeaseDuration, BackoffMin: w.BackoffMin, BackoffMax: w.BackoffMax,
		DependencyWaitDeadline: w.DependencyWaitDeadline,
	}, a.deps.Now, a.deps.NewToken)

	backfilled := false
	pass := func() {
		if !backfilled {
			c, cancel := context.WithTimeout(ctx, w.OperationTimeout)
			_, err := backfill.Run(c)
			cancel()
			if err != nil {
				a.deps.Report("legacy provenance backfill", err)
			} else {
				backfilled = true
			}
		}
		if _, err := worker.Pass(ctx); err != nil {
			a.deps.Report("webhook worker pass", err)
		}
	}
	pass()
	for {
		select {
		case <-ctx.Done():
			return
		case _, ok := <-retries:
			if !ok {
				return
			}
			pass()
		}
	}
}

// resolvePrices resolves every tier's Price ID, retrying on each tick until
// the map is complete.
func (a *Assembly) resolvePrices(ctx context.Context, retries <-chan time.Time) (map[string]string, bool) {
	plans := a.deps.Stripe.Price.SubscriptionPlans()
	for {
		prices, err := a.tierPrices(ctx, plans)
		if err == nil {
			return prices, true
		}
		a.deps.Report("tier price resolution", err)
		select {
		case <-ctx.Done():
			return nil, false
		case _, ok := <-retries:
			if !ok {
				return nil, false
			}
		}
	}
}

func (a *Assembly) tierPrices(ctx context.Context, plans map[string]string) (map[string]string, error) {
	c, cancel := context.WithTimeout(ctx, a.deps.Stripe.Webhook.OperationTimeout)
	defer cancel()
	prices, err := billingstripe.TierPriceIDs(c, a.deps.Client, plans)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for tier := range plans {
		id := prices[tier]
		if id == "" || seen[id] {
			return nil, fmt.Errorf("billing/app: incomplete tier Prices: tier %s has %q", tier, id)
		}
		seen[id] = true
	}
	return prices, nil
}

// checkPortal reports an unsafe or unavailable Portal configuration. It
// stops nothing: every session resolves and checks its own configuration.
func (a *Assembly) checkPortal(ctx context.Context, tierPrices map[string]string) {
	c, cancel := context.WithTimeout(ctx, a.deps.Stripe.Webhook.OperationTimeout)
	defer cancel()
	if _, err := a.portal.PlanChangeConfiguration(c, tierPrices); err != nil {
		a.deps.Report("portal plan-change configuration", err)
	}
	if _, err := a.portal.RestrictedConfiguration(c); err != nil {
		a.deps.Report("portal restricted configuration", err)
	}
}
