// Package billing wires Stripe Checkout/Portal into gin routes. See
// docs/tasks/TASK-SPEC-enx-billing-stripe-subscription.md §3 for the
// endpoint contract this implements (Phase 1: checkout + portal + me;
// webhook handling is Phase 2).
package billing

import (
	"enx-api/config"
	"enx-api/repo"
	"errors"
	"net/http"

	"enx-api/billing/checkout"
	"enx-api/billing/credit"
	"enx-api/billing/subscription"
	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"

	billingstripe "enx-api/billing/stripe"

	"github.com/gin-gonic/gin"
	stripeSDK "github.com/stripe/stripe-go/v86"
)

// Handler wraps a Stripe SDK client (which may be nil if STRIPE_SECRET_KEY
// is not set, same "unconfigured but not fatal" pattern as
// aitranslate.Handler) so billing can be registered as gin route handlers.
type Handler struct {
	sc              *stripeSDK.Client
	frontendBaseURL string
	webhookSecret   string
	// portalConfigurationID and portalRestrictedConfigurationID optionally
	// override the plan-change and restricted Customer Portal configurations
	// (ADR-067); "" resolves them in Stripe.
	portalConfigurationID           string
	portalRestrictedConfigurationID string
	prices                          config.StripePrice
	credits                         config.StripeCredits
	webhooks                        WebhookObserver
	// subscriptions supplies the accepted stored display at cutover.
	subscriptions subscription.Reader
	checkout      *checkout.Service
}

// WebhookObserver hears the outcome of every Stripe webhook delivery:
// metrics.Metrics in production (ADR-040). Nil records nothing.
type WebhookObserver interface {
	ObserveWebhook(eventType, outcome string)
}

// NewHandler builds the billing handler. stripe supplies the webhook secret,
// the price lookup_keys and the credit amounts; sc may be nil (billing off).
func NewHandler(sc *stripeSDK.Client, frontendBaseURL string, stripe config.Stripe, webhooks WebhookObserver) *Handler {
	return &Handler{
		subscriptions:                   repo.BillingSubscriptions{},
		checkout:                        checkout.New(repo.PortalSessionOwners{}, billingstripe.NewPortalClient(sc, "", "", nil)),
		sc:                              sc,
		frontendBaseURL:                 frontendBaseURL,
		webhookSecret:                   stripe.WebhookSecret.Reveal(),
		portalConfigurationID:           stripe.PortalConfigurationID,
		portalRestrictedConfigurationID: stripe.PortalRestrictedConfigurationID,
		prices:                          stripe.Price,
		credits:                         stripe.Credits,
		webhooks:                        webhooks,
	}
}

// NewHandlerWithSubscriptions uses the injected subscription display reader.
func NewHandlerWithSubscriptions(sc *stripeSDK.Client, frontendBaseURL string, stripe config.Stripe, webhooks WebhookObserver, subscriptions subscription.Reader) *Handler {
	h := NewHandler(sc, frontendBaseURL, stripe, webhooks)
	h.subscriptions = subscriptions
	return h
}

// NewHandlerWithCheckout injects subscription ownership and live Stripe assessment.
func NewHandlerWithCheckout(sc *stripeSDK.Client, frontendBaseURL string, stripe config.Stripe, webhooks WebhookObserver, subscriptions subscription.Reader, checkout *checkout.Service) *Handler {
	h := NewHandlerWithSubscriptions(sc, frontendBaseURL, stripe, webhooks, subscriptions)
	h.checkout = checkout
	return h
}

func (h *Handler) checkoutCustomer(c *gin.Context, userID, tier string) (string, bool) {
	if h.checkout == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Billing is temporarily unavailable. Please retry."})
		return "", false
	}
	customer, err := h.checkout.Prepare(c.Request.Context(), userID, tier)
	var refusal *checkout.Refusal
	if errors.As(err, &refusal) {
		body := gin.H{"success": false, "reason": refusal.Reason, "message": "Account deletion is in progress. Please retry later."}
		if refusal.SubscriptionID != "" {
			body["subscriptionId"] = refusal.SubscriptionID
			body["message"] = "Please contact billing support to resolve your subscription conflict."
		}
		c.JSON(http.StatusConflict, body)
		return "", false
	}
	if errors.Is(err, checkout.ErrRefused) {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "You already have a subscription. Manage it from the billing portal."})
		return "", false
	}
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Billing is temporarily unavailable. Please retry."})
		return "", false
	}
	return customer, true
}

type checkoutSubscriptionRequest struct {
	Plan string `json:"plan" binding:"required,oneof=pro pro-plus max"`
}

type checkoutTopupRequest struct {
	Tier string `json:"tier" binding:"required,oneof=small medium large"`
}

// CheckoutSubscription handles POST /billing/checkout/subscription.
func (h *Handler) CheckoutSubscription(c *gin.Context) {
	if h.sc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "billing is not configured"})
		return
	}

	var req checkoutSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": `plan must be "pro", "pro-plus", or "max"`})
		return
	}

	userID := middleware.GetUserIDFromContext(c)
	user := enx.GetUserByID(userID)
	if user.Id == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "user not found"})
		return
	}

	customer, ok := h.checkoutCustomer(c, userID, req.Plan)
	if !ok {
		return
	}
	lookupKey := h.prices.Subscription(req.Plan)
	session, err := billingstripe.CreateCheckoutSession(c.Request.Context(), h.sc, billingstripe.CheckoutSessionParams{
		PriceLookupKey:    lookupKey,
		Mode:              "subscription",
		ClientReferenceID: userID,
		CustomerEmail:     user.Email,
		Customer:          customer,
		SuccessURL:        h.frontendBaseURL + "/billing/success?session_id={CHECKOUT_SESSION_ID}",
		CancelURL:         h.frontendBaseURL + "/billing/cancel",
		Metadata:          map[string]string{"type": "subscription", "plan": req.Plan},
		// ADR-067: events about the Subscription can name its ENX owner.
		SubscriptionMetadata: map[string]string{"enx_user_id": userID},
	})
	if err != nil {
		logger.Errorf("billing: create subscription checkout session failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "failed to create checkout session"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "url": session.URL})
}

// CheckoutTopup handles POST /billing/checkout/topup.
func (h *Handler) CheckoutTopup(c *gin.Context) {
	if h.sc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "billing is not configured"})
		return
	}

	var req checkoutTopupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": `tier must be "small", "medium", or "large"`})
		return
	}

	userID := middleware.GetUserIDFromContext(c)
	user := enx.GetUserByID(userID)
	if user.Id == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "user not found"})
		return
	}

	// No subscription is required: AI translate is unlocked by any credit
	// balance, whether it came from a subscription or a top-up (2026-08-26
	// decision, LAUNCH-CHECKLIST 2.1).
	customer, ok := h.checkoutCustomer(c, userID, "")
	if !ok {
		return
	}
	lookupKey := h.prices.Topup(req.Tier)
	session, err := billingstripe.CreateCheckoutSession(c.Request.Context(), h.sc, billingstripe.CheckoutSessionParams{
		PriceLookupKey:    lookupKey,
		Mode:              "payment",
		ClientReferenceID: userID,
		CustomerEmail:     user.Email,
		Customer:          customer,
		SuccessURL:        h.frontendBaseURL + "/billing/success?session_id={CHECKOUT_SESSION_ID}",
		CancelURL:         h.frontendBaseURL + "/billing/cancel",
		Metadata:          map[string]string{"type": "topup", "tier": req.Tier},
	})
	if err != nil {
		logger.Errorf("billing: create topup checkout session failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "failed to create checkout session"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "url": session.URL})
}

// Portal handles POST /billing/portal. Requires the user to already have a
// Stripe customer (established by a prior checkout), since the Customer
// Portal has nothing to manage otherwise. A blocked user's session uses the
// restricted configuration, everyone else's the plan-change one; either is
// checked first and pinned on the session. A failed lookup or a missing or
// unsafe configuration creates no session, and neither configuration stands
// in for the other (ADR-067).

// portalConfigurationFor decides from the subscription's live Stripe status
// whether userID is blocked, then resolves and checks that configuration.

// Me handles GET /billing/me: current subscription status + credit
// balances, for the frontend to render. Users who have never checked out
// get the zero-value defaults (status "none", zero balances) rather than a
// 404 -- this is the common case for most users and not an error.
func (h *Handler) Me(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)

	var sub subscription.Snapshot
	if h.subscriptions != nil {
		var err error
		sub, err = h.subscriptions.Subscription(c.Request.Context(), userID)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Billing information is unavailable right now. Please try again later."})
			return
		}
	} else {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Billing information is unavailable right now. Please try again later."})
		return
	}
	status := sub.Status
	if status == "" {
		status = "none"
	}

	var account sqlitex.CreditAccount
	sqlitex.DB.Where("user_id = ?", userID).First(&account)

	// The trial pool reports its spendable value: 0 once expired (ADR-048
	// Decision 8). trialExpiresAt is null for an account never granted one.
	trialBalance, trialExpires, err := credit.Trial(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("billing: read trial for %s: %v", userID, err)
	}
	var trialExpiresAt *int64
	if !trialExpires.IsZero() {
		unix := trialExpires.Unix()
		trialExpiresAt = &unix
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"subscription": gin.H{
			"status":           status,
			"plan":             sub.Plan,
			"currentPeriodEnd": sub.CurrentPeriodEnd,
		},
		"credits": gin.H{
			"subscriptionBalance": account.SubscriptionBalance,
			"topupBalance":        account.TopupBalance,
			"trialBalance":        trialBalance,
			"trialExpiresAt":      trialExpiresAt,
		},
	})
}

// Webhook handles POST /billing/webhook. Deliberately unauthenticated
// (no clerkAuth) -- Stripe can't present a Clerk session JWT, so the
// Stripe-Signature header is the only trust boundary (ADR-009 Decision 3).
// Always responds with a bare status (no JSON body): Stripe only inspects
// the status code, and everything here runs before/instead of the normal
// success-envelope convention used by the authenticated endpoints above.

// existingStripeCustomerID looks up a user's Stripe customer id, if a
// subscriptions row already exists for them (from a prior checkout).
// Returns "" for a first-time buyer -- CreateCheckoutSession then prefills
// CustomerEmail, and Stripe creates the customer: subscription mode always
// does, payment mode only because it sends customer_creation=always.
