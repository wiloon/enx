package aitranslate

import (
	"net/http"
	"unicode/utf8"

	"enx-api/aitranslate/rephrase"
	"enx-api/billing/credit"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// maxRephraseInputRunes caps request size (ADR-012 Decision 4). Deliberately
// small for v1 -- the use case is "a message to a colleague" -- and expected
// to grow.
const maxRephraseInputRunes = 200

// RephraseHandler serves POST /rephrase and POST /api/rephrase. It bills by
// actual token usage (ADR-012 Decision 5): a pre-call Balance check, then a
// Settle that may drive the balance negative -- the same TokenLedger the
// sentence translation handler uses (ADR-014).
type RephraseHandler struct {
	rephraser rephrase.Rephraser
	ledger    TokenLedger
	pricing   credit.TokenPricing
}

func NewRephraseHandler(rephraser rephrase.Rephraser, ledger TokenLedger, pricing credit.TokenPricing) *RephraseHandler {
	return &RephraseHandler{rephraser: rephraser, ledger: ledger, pricing: pricing}
}

type rephraseRequest struct {
	Input string `json:"input" binding:"required"`
}

// Rephrase turns Chinese / mixed / rough English into idiomatic workplace
// American English. Billing is post-hoc by actual token usage: a Balance
// pre-check gates the call, and on success Settle charges the real cost
// (ADR-012 Decision 5). A failed provider call is never charged.
func (h *RephraseHandler) Rephrase(c *gin.Context) {
	var req rephraseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "input is required"})
		return
	}
	if utf8.RuneCountInString(req.Input) > maxRephraseInputRunes {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Input is too long (max 200 characters)."})
		return
	}

	if h.rephraser == nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "Rephrase is not configured."})
		return
	}
	if !h.pricing.Priced() {
		logger.Errorf("aitranslate: rephrase is unpriced (%+v)", h.pricing)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "Rephrase service unavailable."})
		return
	}

	userID := middleware.GetUserIDFromContext(c)
	const feature = "rephrase_to_english"

	// Pre-check, not a reservation: any positive balance lets the call
	// through, and Settle afterwards may take the balance negative. The next
	// request is what gets blocked (ADR-012 Decision 5).
	balance, err := h.ledger.Balance(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("aitranslate: rephrase balance check failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "Rephrase service unavailable."})
		return
	}
	if balance < 1 {
		c.JSON(http.StatusPaymentRequired, gin.H{"success": false, "message": "Insufficient credits. Top up or subscribe to continue."})
		return
	}

	result, err := h.rephraser.Rephrase(c.Request.Context(), req.Input)
	if err != nil {
		logger.Errorf("aitranslate: Rephrase failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "Rephrase service unavailable."})
		return
	}

	cost := h.pricing.Cost(result.Usage.PromptTokens, result.Usage.CompletionTokens)
	if settleErr := h.ledger.Settle(c.Request.Context(), userID, feature, cost); settleErr != nil {
		// The call happened and the result is good; a failed Settle write
		// must not cost the user their result. Log for reconciliation.
		logger.Errorf("aitranslate: Settle after rephrase failed (user=%s cost=%d): %v", userID, cost, settleErr)
	}

	// Token counts and provider name are already logged by the provider
	// (kimi.chat); this line records the billing outcome the provider can't
	// know.
	logger.Infof("aitranslate: rephrase billed feature=%s user=%s cost=%d", feature, userID, cost)

	c.JSON(http.StatusOK, gin.H{
		"success":      true,
		"idiomatic":    result.Idiomatic,
		"alternatives": alternativesJSON(result.Alternatives),
		"notes":        notesJSON(result.Notes),
	})
}

func alternativesJSON(in []rephrase.Alternative) []gin.H {
	out := make([]gin.H, 0, len(in))
	for _, a := range in {
		out = append(out, gin.H{"text": a.Text, "register": a.Register})
	}
	return out
}

func notesJSON(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}
