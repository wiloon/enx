package aitranslate

import (
	"context"
	"net/http"

	"enx-api/aitranslate/sentenceword"
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

type sentenceWithWordRequest struct {
	Sentence string `json:"sentence" binding:"required"`
	Word     string `json:"word" binding:"required"`
}

// TokenLedger is the slice of billing/credit the token-billed AI translate
// endpoints need: a Balance pre-check that gates the call and a post-hoc
// Settle by actual token usage (ADR-014). Same shape and semantics as the
// rephrase handler's ledger -- any positive balance lets a call through, and
// Settle afterwards may drive the balance negative; the next request is what
// gets blocked. Injected so tests can fake it; production is
// DefaultTokenLedger.
type TokenLedger interface {
	Balance(ctx context.Context, userID string) (int64, error)
	Settle(ctx context.Context, userID, feature string, cost int64) error
}

// Handler wraps a Translator (which may be nil if sentence translation is
// not configured, see New) so it can be registered as gin route handlers.
// All three endpoints bill by actual token usage through the same
// TokenPricing (ADR-014): translate_sentence, translate_word_in_context and
// translate_sentence_with_word share one model and a near-identical token
// profile, so one price fits all three.
type Handler struct {
	translator Translator
	ledger     TokenLedger
	pricing    credit.TokenPricing
}

func NewHandler(translator Translator, ledger TokenLedger, pricing credit.TokenPricing) *Handler {
	return &Handler{translator: translator, ledger: ledger, pricing: pricing}
}

// billedCall runs the shared pre-flight for a token-billed translate call
// (translator configured, feature priced, caller has a positive balance),
// invokes fn to do the AI work, then settles the real token cost. It writes
// the error response itself and returns false when the caller should stop;
// on true the caller renders the success body. A failed provider call is
// never charged; a failed Settle write never costs the user their result
// (ADR-014, same convention as rephrase).
func (h *Handler) billedCall(c *gin.Context, feature string, fn func(ctx context.Context) (Usage, error)) bool {
	if h.translator == nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "sentence translation is not configured"})
		return false
	}
	if !h.pricing.Priced() {
		logger.Errorf("aitranslate: %s is unpriced (%+v)", feature, h.pricing)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "translation service unavailable"})
		return false
	}

	userID := middleware.GetUserIDFromContext(c)

	balance, err := h.ledger.Balance(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("aitranslate: %s balance check failed: %v", feature, err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "translation service unavailable"})
		return false
	}
	if balance < 1 {
		c.JSON(http.StatusPaymentRequired, gin.H{"success": false, "message": "积分不足，请充值或订阅"})
		return false
	}

	usage, err := fn(c.Request.Context())
	if err != nil {
		logger.Errorf("aitranslate: %s failed: %v", feature, err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "translation service unavailable"})
		return false
	}

	cost := h.pricing.Cost(usage.PromptTokens, usage.CompletionTokens)
	if settleErr := h.ledger.Settle(c.Request.Context(), userID, feature, cost); settleErr != nil {
		logger.Errorf("aitranslate: Settle after %s failed (user=%s cost=%d): %v", feature, userID, cost, settleErr)
	}
	logger.Infof("aitranslate: %s billed user=%s cost=%d", feature, userID, cost)
	return true
}

// TranslateSentence handles POST /translate/sentence and POST
// /api/translate/sentence. It never returns a 200 with an empty/partial
// translation: unavailable or failed translation is always an explicit 502
// (ADR-0001's "no silent empty result").
func (h *Handler) TranslateSentence(c *gin.Context) {
	var req sentenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "sentence is required"})
		return
	}

	var chinese string
	ok := h.billedCall(c, "translate_sentence", func(ctx context.Context) (Usage, error) {
		var u Usage
		var err error
		chinese, u, err = h.translator.TranslateSentence(ctx, req.Sentence)
		return u, err
	})
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "chinese": chinese})
}

// TranslateWordInContext handles POST /translate/word-in-context and POST
// /api/translate/word-in-context. It translates a single word using the
// surrounding sentence as context, so the result is the word's meaning as
// used in that sentence rather than a generic dictionary gloss (see
// docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §3.8).
func (h *Handler) TranslateWordInContext(c *gin.Context) {
	var req wordInContextRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "sentence and word are required"})
		return
	}

	var chinese string
	ok := h.billedCall(c, "translate_word_in_context", func(ctx context.Context) (Usage, error) {
		var u Usage
		var err error
		chinese, u, err = h.translator.TranslateWordInContext(ctx, req.Sentence, req.Word)
		return u, err
	})
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "chinese": chinese})
}

// TranslateSentenceWithWord handles POST /translate/sentence-with-word and
// POST /api/translate/sentence-with-word (ADR-014): one LLM call returns
// both the whole-sentence translation and `word`'s meaning in that
// sentence's context, so the Side Panel opened from a word click needs just
// one AI round-trip instead of two. `wordChinese` in the response may be an
// empty string if the model omitted it -- the client falls back to a
// separate word-in-context call rather than the whole request failing.
func (h *Handler) TranslateSentenceWithWord(c *gin.Context) {
	var req sentenceWithWordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "sentence and word are required"})
		return
	}

	var res sentenceword.Result
	ok := h.billedCall(c, "translate_sentence_with_word", func(ctx context.Context) (Usage, error) {
		var u Usage
		var err error
		res, u, err = h.translator.TranslateSentenceWithWord(ctx, req.Sentence, req.Word)
		return u, err
	})
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"chinese":     res.SentenceChinese,
		"wordChinese": res.WordChinese,
	})
}
