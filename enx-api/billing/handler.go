// Package billing wires Stripe Checkout/Portal into gin routes. See
// docs/tasks/TASK-SPEC-enx-billing-stripe-subscription.md §3 for the
// endpoint contract this implements (Phase 1: checkout + portal + me;
// webhook handling is Phase 2).
package billing

import (
	"context"
	"enx-api/config"
	"errors"
	"fmt"
	"io"
	"net/http"

	"enx-api/billing/credit"
	"enx-api/email"
	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/referral"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"

	billingstripe "enx-api/billing/stripe"

	"github.com/gin-gonic/gin"
	stripeSDK "github.com/stripe/stripe-go/v86"
	"gorm.io/gorm"
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
	// refunds hears about refunds that matched no grant; nil logs only.
	refunds RefundNotifier
	// payments hears about every paid top-up and subscription invoice, for
	// referral rewards; nil records nothing.
	payments FirstPaymentRecorder
}

// FirstPaymentRecorder notes a payment for ADR-051's referrer reward:
// *referral.Service in production. It decides itself whether the payment is
// the user's first.
type FirstPaymentRecorder interface {
	RecordFirstPayment(ctx context.Context, userID string, p referral.FirstPayment) error
}

// WithFirstPaymentRecorder sets who hears about payments.
func (h *Handler) WithFirstPaymentRecorder(r FirstPaymentRecorder) *Handler {
	h.payments = r
	return h
}

// RefundNotifier tells the admin about a refund ENX could not match to a
// credit grant (ADR-049 Decision 7): *email.Sender in production.
type RefundNotifier interface {
	NotifyAdminUnmatchedRefund(r email.UnmatchedRefundNotify) error
}

// WithRefundNotifier sets who hears about unmatched refunds.
func (h *Handler) WithRefundNotifier(n RefundNotifier) *Handler {
	h.refunds = n
	return h
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

func (h *Handler) observeWebhook(eventType, outcome string) {
	if h.webhooks != nil {
		h.webhooks.ObserveWebhook(eventType, outcome)
	}
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

	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		logger.Errorf("billing: load subscription for %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to load subscription"})
		return
	}
	if hasLiveSubscription(sub) {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "You already have a subscription. Manage it from the billing portal."})
		return
	}

	lookupKey := h.prices.Subscription(req.Plan)
	session, err := billingstripe.CreateCheckoutSession(c.Request.Context(), h.sc, billingstripe.CheckoutSessionParams{
		PriceLookupKey:    lookupKey,
		Mode:              "subscription",
		ClientReferenceID: userID,
		CustomerEmail:     user.Email,
		Customer:          existingStripeCustomerID(userID),
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
	lookupKey := h.prices.Topup(req.Tier)
	session, err := billingstripe.CreateCheckoutSession(c.Request.Context(), h.sc, billingstripe.CheckoutSessionParams{
		PriceLookupKey:    lookupKey,
		Mode:              "payment",
		ClientReferenceID: userID,
		CustomerEmail:     user.Email,
		Customer:          existingStripeCustomerID(userID),
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
func (h *Handler) Portal(c *gin.Context) {
	if h.sc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "billing is not configured"})
		return
	}

	userID := middleware.GetUserIDFromContext(c)
	customerID := existingStripeCustomerID(userID)
	if customerID == "" {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "no billing account yet"})
		return
	}

	configurationID, err := h.portalConfigurationFor(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("billing: portal refused: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "The billing portal is unavailable right now. Please try again later."})
		return
	}

	session, err := billingstripe.CreatePortalSession(c.Request.Context(), h.sc, customerID, configurationID, h.frontendBaseURL+"/billing")
	if err != nil {
		logger.Errorf("billing: create portal session failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "failed to create portal session"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "url": session.URL})
}

// portalConfigurationFor decides from the subscription's live Stripe status
// whether userID is blocked, then resolves and checks that configuration.
func (h *Handler) portalConfigurationFor(ctx context.Context, userID string) (string, error) {
	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", fmt.Errorf("load subscription for %s: %w", userID, err)
	}
	liveStatus := ""
	if sub.StripeSubscriptionId != nil && *sub.StripeSubscriptionId != "" {
		live, err := billingstripe.RetrieveSubscription(ctx, h.sc, *sub.StripeSubscriptionId)
		if err != nil {
			return "", fmt.Errorf("read subscription %s: %w", *sub.StripeSubscriptionId, err)
		}
		liveStatus = string(live.Status)
	}
	if portalRestricted(liveStatus) {
		return billingstripe.ResolveRestrictedPortalConfiguration(ctx, h.sc, h.portalRestrictedConfigurationID)
	}
	tierPrices, err := billingstripe.TierPriceIDs(ctx, h.sc, h.prices.SubscriptionPlans())
	if err != nil {
		return "", err
	}
	return billingstripe.ResolvePlanChangePortalConfiguration(ctx, h.sc, h.portalConfigurationID, tierPrices)
}

// Me handles GET /billing/me: current subscription status + credit
// balances, for the frontend to render. Users who have never checked out
// get the zero-value defaults (status "none", zero balances) rather than a
// 404 -- this is the common case for most users and not an error.
func (h *Handler) Me(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)

	var sub sqlitex.Subscription
	sqlitex.DB.Where("user_id = ?", userID).First(&sub)
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
func (h *Handler) Webhook(c *gin.Context) {
	if h.sc == nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}

	payload, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}

	event, err := billingstripe.ConstructEvent(payload, c.GetHeader("Stripe-Signature"), h.webhookSecret)
	if err != nil {
		logger.Warnf("billing: webhook signature verification failed: %v", err)
		// The type of an unverified payload can't be trusted as a label.
		h.observeWebhook("unknown", "bad_signature")
		c.Status(http.StatusBadRequest)
		return
	}

	if err := h.dispatchWebhookEvent(c.Request.Context(), event); err != nil {
		// Non-2xx makes Stripe retry with backoff -- correct for both
		// transient failures (DB hiccup) and "our local subscriptions row
		// isn't there yet because events arrived out of order," which
		// resolves itself on retry once the missing event lands.
		logger.Errorf("billing: webhook event id=%s type=%s failed: %v", event.ID, event.Type, err)
		h.observeWebhook(webhookEventLabel(event.Type), "error")
		c.Status(http.StatusInternalServerError)
		return
	}

	h.observeWebhook(webhookEventLabel(event.Type), "ok")
	c.Status(http.StatusOK)
}

// existingStripeCustomerID looks up a user's Stripe customer id, if a
// subscriptions row already exists for them (from a prior checkout).
// Returns "" for a first-time buyer -- CreateCheckoutSession then prefills
// CustomerEmail, and Stripe creates the customer: subscription mode always
// does, payment mode only because it sends customer_creation=always.
func existingStripeCustomerID(userID string) string {
	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil {
		return ""
	}
	return sub.StripeCustomerId
}
