// Package billing wires Stripe Checkout/Portal into gin routes. See
// docs/tasks/TASK-SPEC-enx-billing-stripe-subscription.md §3 for the
// endpoint contract this implements (Phase 1: checkout + portal + me;
// webhook handling is Phase 2).
package billing

import (
	"io"
	"net/http"

	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"

	billingstripe "enx-api/billing/stripe"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	stripeSDK "github.com/stripe/stripe-go/v86"
)

// Handler wraps a Stripe SDK client (which may be nil if STRIPE_SECRET_KEY
// is not set, same "unconfigured but not fatal" pattern as
// aitranslate.Handler) so billing can be registered as gin route handlers.
type Handler struct {
	sc              *stripeSDK.Client
	frontendBaseURL string
	webhookSecret   string
}

func NewHandler(sc *stripeSDK.Client, frontendBaseURL, webhookSecret string) *Handler {
	return &Handler{sc: sc, frontendBaseURL: frontendBaseURL, webhookSecret: webhookSecret}
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

	lookupKey := viper.GetString("stripe.price." + req.Plan)
	session, err := billingstripe.CreateCheckoutSession(c.Request.Context(), h.sc, billingstripe.CheckoutSessionParams{
		PriceLookupKey:    lookupKey,
		Mode:              "subscription",
		ClientReferenceID: userID,
		CustomerEmail:     user.Email,
		Customer:          existingStripeCustomerID(userID),
		SuccessURL:        h.frontendBaseURL + "/billing/success?session_id={CHECKOUT_SESSION_ID}",
		CancelURL:         h.frontendBaseURL + "/billing/cancel",
		Metadata:          map[string]string{"type": "subscription", "plan": req.Plan},
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

	if !hasActiveSubscription(userID) {
		// AI translate access requires Pro or above; credit top-ups top off
		// an existing subscription's allowance rather than being a free-tier
		// way to buy AI translate without ever subscribing (2026-08-26
		// decision, see w10n-config/enx/monetization-tasks.md).
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "an active enx Pro (or higher) subscription is required before buying AI credits"})
		return
	}

	lookupKey := viper.GetString("stripe.price.credits-topup-" + req.Tier)
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
// Portal has nothing to manage otherwise.
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

	session, err := billingstripe.CreatePortalSession(c.Request.Context(), h.sc, customerID, h.frontendBaseURL+"/billing")
	if err != nil {
		logger.Errorf("billing: create portal session failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "failed to create portal session"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "url": session.URL})
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

	var credit sqlitex.CreditAccount
	sqlitex.DB.Where("user_id = ?", userID).First(&credit)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"subscription": gin.H{
			"status":           status,
			"plan":             sub.Plan,
			"currentPeriodEnd": sub.CurrentPeriodEnd,
		},
		"credits": gin.H{
			"subscriptionBalance": credit.SubscriptionBalance,
			"topupBalance":        credit.TopupBalance,
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
		c.Status(http.StatusBadRequest)
		return
	}

	if err := h.dispatchWebhookEvent(c.Request.Context(), event); err != nil {
		// Non-2xx makes Stripe retry with backoff -- correct for both
		// transient failures (DB hiccup) and "our local subscriptions row
		// isn't there yet because events arrived out of order," which
		// resolves itself on retry once the missing event lands.
		logger.Errorf("billing: webhook event id=%s type=%s failed: %v", event.ID, event.Type, err)
		c.Status(http.StatusInternalServerError)
		return
	}

	c.Status(http.StatusOK)
}

// existingStripeCustomerID looks up a user's Stripe customer id, if a
// subscriptions row already exists for them (from a prior checkout).
// Returns "" for a first-time buyer -- CreateCheckoutSession then falls
// back to CustomerEmail and lets Stripe create the customer.
func existingStripeCustomerID(userID string) string {
	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil {
		return ""
	}
	return sub.StripeCustomerId
}

// hasActiveSubscription reports whether userID currently has an active
// subscription at any tier (pro/pro-plus/max). Used to gate CheckoutTopup:
// AI credit top-ups require an existing Pro-or-above subscription (see
// w10n-config/enx/monetization-tasks.md, 2026-08-26 decision).
func hasActiveSubscription(userID string) bool {
	var sub sqlitex.Subscription
	if err := sqlitex.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil {
		return false
	}
	return sub.Status == "active"
}
