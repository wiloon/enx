package adminuser

import (
	"errors"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"

	"enx-api/billing/creditledger"
	"enx-api/platform/httpjson"
	"enx-api/platform/httpquery"
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
	limit, okLimit := httpquery.Int(c, "limit", 0)
	offset, okOffset := httpquery.Int(c, "offset", 0)
	if !okLimit || !okOffset {
		httpjson.Fail(c, http.StatusBadRequest, "limit and offset must be whole numbers")
		return
	}
	page, err := h.svc.List(c.Request.Context(), ListParams{
		Query: c.Query("q"), Sort: Sort(c.Query("sort")), Limit: limit, Offset: offset,
	})
	if errors.Is(err, ErrInvalidSort) {
		httpjson.Fail(c, http.StatusBadRequest, "sort must be created, last_login or balance")
		return
	}
	if err != nil {
		logger.Errorf("admin users: list: %v", err)
		httpjson.Fail(c, http.StatusInternalServerError, "failed to list users")
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
		httpjson.Fail(c, http.StatusNotFound, "no such user")
		return
	}
	if err != nil {
		logger.Errorf("admin users: detail %s: %v", c.Param("id"), err)
		httpjson.Fail(c, http.StatusInternalServerError, "failed to load user")
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

// Transactions handles GET /api/admin/users/:id/transactions?limit=&before=&direction=.
func (h *Handler) Transactions(c *gin.Context) {
	limit, ok := httpquery.Int(c, "limit", 0)
	if !ok {
		httpjson.Fail(c, http.StatusBadRequest, "limit must be a whole number")
		return
	}
	page, err := h.svc.Transactions(c.Request.Context(), c.Param("id"), c.Query("before"), c.Query("direction"), limit)
	switch {
	case errors.Is(err, ErrUserNotFound):
		httpjson.Fail(c, http.StatusNotFound, "no such user")
		return
	case errors.Is(err, creditledger.ErrInvalidCursor):
		httpjson.Fail(c, http.StatusBadRequest, "before is not a valid cursor")
		return
	case errors.Is(err, creditledger.ErrInvalidDirection):
		httpjson.Fail(c, http.StatusBadRequest, "direction must be in or out")
		return
	case err != nil:
		logger.Errorf("admin users: transactions %s: %v", c.Param("id"), err)
		httpjson.Fail(c, http.StatusInternalServerError, "failed to load transactions")
		return
	}
	rows := make([]gin.H, len(page.Entries))
	for i, e := range page.Entries {
		rows[i] = gin.H{
			"id": e.ID, "type": e.Type, "amount": e.Amount, "balanceAfter": e.BalanceAfter, "totalBalanceAfter": e.TotalBalanceAfter,
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
