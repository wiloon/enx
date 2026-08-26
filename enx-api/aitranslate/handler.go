package aitranslate

import (
	"context"
	"errors"
	"net/http"

	"enx-api/billing/credit"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

type sentenceRequest struct {
	Sentence string `json:"sentence" binding:"required"`
}

type wordInContextRequest struct {
	Sentence string `json:"sentence" binding:"required"`
	Word     string `json:"word" binding:"required"`
}

// CreditLedger is the subset of billing/credit's ledger operations
// TranslateSentence/TranslateWordInContext need (TASK-SPEC §4.1). Injected
// like Translator so tests can fake it instead of touching a real
// database; production wiring is DefaultCreditLedger.
type CreditLedger interface {
	Consume(ctx context.Context, userID, feature string, cost int64) (pool string, err error)
	Refund(ctx context.Context, userID, feature, pool string, cost int64) error
}

// Handler wraps a Translator (which may be nil if sentence translation is
// not configured, see New) so it can be registered as a gin route handler.
type Handler struct {
	translator                 Translator
	credits                    CreditLedger
	costTranslateSentence      int64
	costTranslateWordInContext int64
}

func NewHandler(translator Translator, credits CreditLedger, costTranslateSentence, costTranslateWordInContext int64) *Handler {
	return &Handler{
		translator:                 translator,
		credits:                    credits,
		costTranslateSentence:      costTranslateSentence,
		costTranslateWordInContext: costTranslateWordInContext,
	}
}

// TranslateSentence handles POST /translate/sentence and POST
// /api/translate/sentence. It never returns a 200 with an empty/partial
// translation: unavailable or failed translation is always an explicit
// 502, matching the "no silent empty result" convention from
// ADR-0001 (see translate/helpers.go RespondUnavailable-style handling).
//
// Credits are consumed BEFORE calling the AI provider (TASK-SPEC §4.1):
// this avoids a free-AI-call race where the provider call succeeds but a
// concurrent request drains the balance before we'd have charged for it.
// If the provider call then fails, the consumed credit is refunded --
// service failures shouldn't cost the user anything.
func (h *Handler) TranslateSentence(c *gin.Context) {
	var req sentenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "sentence is required"})
		return
	}

	if h.translator == nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "sentence translation is not configured"})
		return
	}

	userID := middleware.GetUserIDFromContext(c)
	const feature = "translate_sentence"
	pool, err := h.credits.Consume(c.Request.Context(), userID, feature, h.costTranslateSentence)
	if err != nil {
		if errors.Is(err, credit.ErrInsufficientCredit) {
			c.JSON(http.StatusPaymentRequired, gin.H{"success": false, "message": "积分不足，请充值或订阅"})
			return
		}
		logger.Errorf("aitranslate: credit.Consume failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "translation service unavailable"})
		return
	}

	chinese, err := h.translator.TranslateSentence(c.Request.Context(), req.Sentence)
	if err != nil {
		logger.Errorf("aitranslate: TranslateSentence failed: %v", err)
		if refundErr := h.credits.Refund(c.Request.Context(), userID, feature, pool, h.costTranslateSentence); refundErr != nil {
			logger.Errorf("aitranslate: refund after failed TranslateSentence failed: %v", refundErr)
		}
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "translation service unavailable"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "chinese": chinese})
}

// TranslateWordInContext handles POST /translate/word-in-context and POST
// /api/translate/word-in-context. It translates a single word using the
// surrounding sentence as context, so the result is the word's meaning as
// used in that sentence rather than a generic dictionary gloss (see
// docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §3.8).
// Same "no silent empty result" convention and credit consume/refund flow
// as TranslateSentence.
func (h *Handler) TranslateWordInContext(c *gin.Context) {
	var req wordInContextRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "sentence and word are required"})
		return
	}

	if h.translator == nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "sentence translation is not configured"})
		return
	}

	userID := middleware.GetUserIDFromContext(c)
	const feature = "translate_word_in_context"
	pool, err := h.credits.Consume(c.Request.Context(), userID, feature, h.costTranslateWordInContext)
	if err != nil {
		if errors.Is(err, credit.ErrInsufficientCredit) {
			c.JSON(http.StatusPaymentRequired, gin.H{"success": false, "message": "积分不足，请充值或订阅"})
			return
		}
		logger.Errorf("aitranslate: credit.Consume failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "translation service unavailable"})
		return
	}

	chinese, err := h.translator.TranslateWordInContext(c.Request.Context(), req.Sentence, req.Word)
	if err != nil {
		logger.Errorf("aitranslate: TranslateWordInContext failed: %v", err)
		if refundErr := h.credits.Refund(c.Request.Context(), userID, feature, pool, h.costTranslateWordInContext); refundErr != nil {
			logger.Errorf("aitranslate: refund after failed TranslateWordInContext failed: %v", refundErr)
		}
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "translation service unavailable"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "chinese": chinese})
}
