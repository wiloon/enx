package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"enx-api/creditledger"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// CreditHistoryHandler serves the signed-in user's own credit ledger
// (ADR-063 Decision 3). Mount behind clerkAuth.
type CreditHistoryHandler struct {
	ledger *creditledger.Reader
}

func NewCreditHistoryHandler(ledger *creditledger.Reader) *CreditHistoryHandler {
	return &CreditHistoryHandler{ledger: ledger}
}

// userTransactionJSON is one row of the user's history. It is its own type,
// built field by field, so a field added to the admin's timeline never
// reaches users.
type userTransactionJSON struct {
	CreatedAt         string `json:"createdAt"`
	Type              string `json:"type"`
	Feature           string `json:"feature"`
	Amount            int64  `json:"amount"`
	TotalBalanceAfter *int64 `json:"totalBalanceAfter"`
	Note              string `json:"note,omitempty"`
}

// List handles GET /api/me/credits/transactions?limit=&before=&direction=.
func (h *CreditHistoryHandler) List(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	limit := 0
	if v := c.Query("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "limit must be a whole number"})
			return
		}
		limit = n
	}
	page, err := h.ledger.Page(c.Request.Context(), userID, c.Query("before"), c.Query("direction"), limit)
	switch {
	case errors.Is(err, creditledger.ErrInvalidCursor):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "before is not a valid cursor"})
		return
	case errors.Is(err, creditledger.ErrInvalidDirection):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "direction must be in or out"})
		return
	case err != nil:
		logger.Errorf("credit history: %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to load your credit history"})
		return
	}
	rows := make([]userTransactionJSON, len(page.Entries))
	for i, e := range page.Entries {
		u := creditledger.ForUser(e.Transaction)
		rows[i] = userTransactionJSON{
			CreatedAt:         u.CreatedAt.UTC().Format(time.RFC3339Nano),
			Type:              u.Type,
			Feature:           u.Feature,
			Amount:            u.Amount,
			TotalBalanceAfter: u.TotalBalanceAfter,
			Note:              u.Note,
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "transactions": rows, "next": page.Next})
}
