package adminuser

import (
	"errors"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"enx-api/utils/logger"
)

// Handler serves the admin users API (ADR-049 Decision 11). Mount behind
// clerkAuth + RequireAdmin.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// List handles GET /api/admin/users?q=&sort=&limit=&offset=.
func (h *Handler) List(c *gin.Context) {
	limit, okLimit := intQuery(c, "limit")
	offset, okOffset := intQuery(c, "offset")
	if !okLimit || !okOffset {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "limit and offset must be whole numbers"})
		return
	}
	page, err := h.svc.List(c.Request.Context(), ListParams{
		Query: c.Query("q"), Sort: Sort(c.Query("sort")), Limit: limit, Offset: offset,
	})
	if errors.Is(err, ErrInvalidSort) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "sort must be created, last_login or balance"})
		return
	}
	if err != nil {
		logger.Errorf("admin users: list: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to list users"})
		return
	}
	users := make([]gin.H, len(page.Users))
	for i, u := range page.Users {
		users[i] = summaryJSON(u)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "users": users, "total": page.Total})
}

// Detail handles GET /api/admin/users/:id.
func (h *Handler) Detail(c *gin.Context) {
	d, err := h.svc.Detail(c.Request.Context(), c.Param("id"))
	if errors.Is(err, ErrUserNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "no such user"})
		return
	}
	if err != nil {
		logger.Errorf("admin users: detail %s: %v", c.Param("id"), err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to load user"})
		return
	}

	user := summaryJSON(d.UserSummary)
	user["stripeCustomerId"] = d.StripeCustomerID
	user["stripeDashboardUrl"] = d.StripeDashboardURL
	days := make([]gin.H, len(d.DailyLookups))
	for i, day := range d.DailyLookups {
		days[i] = gin.H{"date": day.Date, "count": day.Count}
	}
	spend := make([]gin.H, 0, len(d.AISpend))
	for feature, credits := range d.AISpend {
		spend = append(spend, gin.H{"feature": feature, "credits": credits})
	}
	sort.Slice(spend, func(i, j int) bool {
		if spend[i]["credits"].(int64) != spend[j]["credits"].(int64) {
			return spend[i]["credits"].(int64) > spend[j]["credits"].(int64)
		}
		return spend[i]["feature"].(string) < spend[j]["feature"].(string)
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "user": user, "dailyLookups": days, "aiSpend": spend})
}

// Transactions handles GET /api/admin/users/:id/transactions?limit=&before=.
func (h *Handler) Transactions(c *gin.Context) {
	limit, ok := intQuery(c, "limit")
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "limit must be a whole number"})
		return
	}
	page, err := h.svc.Transactions(c.Request.Context(), c.Param("id"), c.Query("before"), limit)
	switch {
	case errors.Is(err, ErrUserNotFound):
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "no such user"})
		return
	case errors.Is(err, ErrInvalidCursor):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "before is not a valid cursor"})
		return
	case err != nil:
		logger.Errorf("admin users: transactions %s: %v", c.Param("id"), err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to load transactions"})
		return
	}
	rows := make([]gin.H, len(page.Entries))
	for i, e := range page.Entries {
		rows[i] = gin.H{
			"id": e.ID, "type": e.Type, "amount": e.Amount, "balanceAfter": e.BalanceAfter,
			"feature": e.Feature, "note": e.Note, "createdAt": e.CreatedAt.UTC().Format(time.RFC3339Nano),
			"source": e.Source,
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "transactions": rows, "next": page.Next})
}

func summaryJSON(u UserSummary) gin.H {
	var trialExpiresAt any
	if u.TrialExpiresAt != nil {
		trialExpiresAt = u.TrialExpiresAt.UTC().Format(time.RFC3339)
	}
	return gin.H{
		"id":                 u.UserID,
		"email":              u.Email,
		"name":               u.Name,
		"status":             u.Status,
		"createdAt":          timeOrNil(u.CreatedAt),
		"lastLoginAt":        timeOrNil(u.LastLoginAt),
		"plan":               u.Plan,
		"subscriptionStatus": u.SubscriptionStatus,
		"balances": gin.H{
			"subscription":   u.SubscriptionBalance,
			"topup":          u.TopupBalance,
			"trial":          u.TrialSpendable,
			"trialExpiresAt": trialExpiresAt,
			"total":          u.Balance,
		},
		"totals": gin.H{
			"paid":       u.Totals.Paid,
			"gifted":     u.Totals.Gifted,
			"trial":      u.Totals.Trial,
			"consumed":   u.Totals.Consumed,
			"clawedBack": u.Totals.ClawedBack,
		},
		"hadClawback": u.HadClawback,
	}
}

func timeOrNil(t time.Time) any {
	if t.IsZero() || t.Year() <= 1 {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

// intQuery reads an optional integer query parameter; 0 when absent.
func intQuery(c *gin.Context, name string) (int, bool) {
	v := c.Query(name)
	if v == "" {
		return 0, true
	}
	n, err := strconv.Atoi(v)
	return n, err == nil
}
