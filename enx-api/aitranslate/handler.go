package aitranslate

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"enx-api/ailimit"
	"enx-api/aitranslate/aifailure"
	"enx-api/aitranslate/llm"
	"enx-api/aitranslate/sentence"
	"enx-api/aitranslate/sentenceword"
	"enx-api/aitranslate/wordcontext"
	"enx-api/billing/credit"
	"enx-api/dictionary"
	"enx-api/dictsample"
	"enx-api/middleware"
	"enx-api/platform/httpjson"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

type sentenceRequest struct {
	Sentence string `json:"sentence" binding:"required"`
}

type wordInContextRequest struct {
	Sentence string `json:"sentence" binding:"required"`
	Word     string `json:"word" binding:"required"`
	// DictionaryDefinition is the word's dictionary definition, looked up by
	// the client BEFORE this call. Empty is valid -- no dictionary entry,
	// or the lookup failed -- in which case the response's "why" is always
	// empty too (nothing to compare the contextual meaning against).
	DictionaryDefinition string `json:"dictionaryDefinition"`
	// DictionaryChinese is what older extensions send in its place.
	DictionaryChinese string `json:"dictionaryChinese"`
}

type sentenceWithWordsRequest struct {
	Sentence string `json:"sentence"`
	Words    []struct {
		Word string `json:"word"`
		// Both may be empty (no entry, or the lookup failed); see
		// wordInContextRequest.
		DictionaryDefinition string `json:"dictionaryDefinition"`
		DictionaryChinese    string `json:"dictionaryChinese"`
	} `json:"words"`
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

// Handler wraps a Provider (which may be nil if sentence translation is
// not configured, see New) so it can be registered as gin route handlers.
// All three endpoints bill by actual token usage through the same
// TokenPricing (ADR-014): translate_sentence, translate_word_in_context and
// translate_sentence_with_word share one model and a near-identical token
// profile, so one price fits all three.
type Handler struct {
	provider  *Provider
	ledger    TokenLedger
	pricing   credit.TokenPricing
	trialGate CallGate
	languages dictionary.ExplanationLanguages // nil: everyone is zh-Hans
}

// CallGate holds trial-only users to the trial's call rate (ADR-048
// Decision 7); production is an *ailimit.TrialGate.
type CallGate interface {
	Check(ctx context.Context, userID string) ailimit.Verdict
}

// WithTrialGate turns on the trial call-rate limit. Without it no call is
// rate-limited.
func (h *Handler) WithTrialGate(gate CallGate) *Handler {
	h.trialGate = gate
	return h
}

// WithExplanationLanguages makes the endpoints answer in each user's
// explanation language (ADR-098). Without it they answer in zh-Hans.
func (h *Handler) WithExplanationLanguages(languages dictionary.ExplanationLanguages) *Handler {
	h.languages = languages
	return h
}

// english reports whether the caller wants plain-English explanations. A
// failed read is not taken as zh-Hans (ADR-098 Decision 5): it answers the
// internal error and returns ok false, before anything is billed or counted.
func (h *Handler) english(c *gin.Context) (english, ok bool) {
	if h.languages == nil {
		return false, true
	}
	userID := middleware.GetUserIDFromContext(c)
	lang, err := h.languages.ExplanationLanguage(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("aitranslate: explanation language read failed (user=%s): %v", userID, err)
		aifailure.Internal(c)
		return false, false
	}
	return lang == dictionary.LanguageEnglish, true
}

// effectiveDefinition is the definition a request carries for one word.
func effectiveDefinition(definition, chinese string) string {
	if definition != "" {
		return definition
	}
	return chinese
}

// refuseOverTrialLimit writes a 429 and returns true when gate refuses
// userID's call. It runs after the balance pre-check, so a user who can't
// pay is told so and doesn't use up a trial slot.
func refuseOverTrialLimit(c *gin.Context, gate CallGate, userID string) bool {
	if gate == nil {
		return false
	}
	switch gate.Check(c.Request.Context(), userID) {
	case ailimit.LimitedPerDay:
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "code": "trial_limit_day", "message": ailimit.DayLimitMessage(time.Now())})
		return true
	case ailimit.LimitedPerMinute:
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "code": "trial_limit_minute", "message": "Too many requests. Please wait a minute and try again."})
		return true
	}
	return false
}

func NewHandler(provider *Provider, ledger TokenLedger, pricing credit.TokenPricing) *Handler {
	return &Handler{provider: provider, ledger: ledger, pricing: pricing}
}

// billedCall runs the shared pre-flight for a token-billed translate call
// (translator configured, feature priced, caller has a positive balance),
// invokes fn to do the AI work, then settles the real token cost. It writes
// the error response itself and returns false when the caller should stop;
// on true the caller renders the success body. A call that reached the model
// is charged even when fn fails (ADR-094, see settleFailedCall); a failed
// Settle write never costs the user their result (ADR-014, same convention
// as rephrase).
func (h *Handler) billedCall(c *gin.Context, feature string, fn func(ctx context.Context) (Usage, error)) bool {
	if h.provider == nil {
		aifailure.Internal(c)
		return false
	}
	if !h.pricing.Priced() {
		logger.Errorf("aitranslate: %s is unpriced (%+v)", feature, h.pricing)
		aifailure.Internal(c)
		return false
	}

	userID := middleware.GetUserIDFromContext(c)

	balance, err := h.ledger.Balance(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("aitranslate: %s balance check failed: %v", feature, err)
		aifailure.Internal(c)
		return false
	}
	if balance < 1 {
		httpjson.Fail(c, http.StatusPaymentRequired, "Insufficient credit. Please add credit or subscribe.")
		return false
	}
	if refuseOverTrialLimit(c, h.trialGate, userID) {
		return false
	}

	usage, err := fn(c.Request.Context())
	if err != nil {
		settleFailedCall(c.Request.Context(), h.ledger, h.pricing, feature, userID, usage.PromptTokens, usage.CompletionTokens, err)
		aifailure.Upstream(c)
		return false
	}

	cost := h.pricing.Cost(usage.PromptTokens, usage.CompletionTokens)
	if settleErr := h.ledger.Settle(c.Request.Context(), userID, feature, cost); settleErr != nil {
		logger.Errorf("aitranslate: Settle after %s failed (user=%s cost=%d): %v", feature, userID, cost, settleErr)
	}
	logger.Infof("aitranslate: %s billed user=%s cost=%d", feature, userID, cost)
	return true
}

// settleFailedCall bills and logs a model call that returned callErr
// (ADR-094). With nonzero usage the model ran, so its tokens are settled and
// ai_call_billed_on_failure tells a log review whom to compensate. With zero
// usage nothing is charged and ai_call_failed_unbilled alerts ops, unless
// the client cancelled the request.
func settleFailedCall(ctx context.Context, ledger TokenLedger, pricing credit.TokenPricing, feature, userID string, promptTokens, completionTokens int, callErr error) {
	// Test the tokens, not the cost: Cost floors at 1 even for no tokens.
	if promptTokens <= 0 && completionTokens <= 0 {
		if errors.Is(ctx.Err(), context.Canceled) {
			logger.Infof("aitranslate: %s cancelled by the client (user=%s): %v", feature, userID, callErr)
			return
		}
		logger.Errorw("ai_call_failed_unbilled", "feature", feature, "user_id", userID, "error", callErr.Error())
		return
	}

	cost := pricing.Cost(promptTokens, completionTokens)
	// The tokens are spent whether or not the client is still there, and the
	// ledger writes nothing on a cancelled context.
	settleErr := ledger.Settle(context.WithoutCancel(ctx), userID, feature, cost)
	if settleErr != nil {
		logger.Errorf("aitranslate: Settle after %s failed (user=%s cost=%d): %v", feature, userID, cost, settleErr)
	}
	logger.Errorw("ai_call_billed_on_failure",
		"feature", feature, "user_id", userID,
		"prompt_tokens", promptTokens, "completion_tokens", completionTokens,
		"cost", cost, "settled", settleErr == nil, "error", callErr.Error())
}

// TranslateSentence handles POST /api/translate/sentence. It never returns a 200 with an empty/partial
// translation: unavailable or failed translation is always an explicit 502
// (ADR-0001's "no silent empty result").
func (h *Handler) TranslateSentence(c *gin.Context) {
	var req sentenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpjson.Fail(c, http.StatusBadRequest, "sentence is required")
		return
	}

	english, ok := h.english(c)
	if !ok {
		return
	}
	call := sentence.Call
	if english {
		call = sentence.CallEnglish
	}

	var chinese string
	ok = h.billedCall(c, "translate_sentence", func(ctx context.Context) (Usage, error) {
		var u Usage
		var err error
		chinese, u, err = observe(h.provider, "translate_sentence", func() (string, Usage, error) {
			return call(ctx, h.provider.Chat, req.Sentence)
		})
		// After the observed call: a reply that fails a check is still
		// billed (ADR-094) and its metric outcome stays ok.
		if err == nil {
			err = sentence.Check(chinese)
		}
		if err == nil && english {
			err = sentence.CheckEnglish(chinese, req.Sentence)
		}
		return u, err
	})
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "chinese": chinese})
}

// TranslateWordInContext handles POST /api/translate/word-in-context. It translates a single word using the
// surrounding sentence as context, so the result is the word's meaning as
// used in that sentence rather than a generic dictionary gloss (see
// docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §3.8).
func (h *Handler) TranslateWordInContext(c *gin.Context) {
	var req wordInContextRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpjson.Fail(c, http.StatusBadRequest, "sentence and word are required")
		return
	}

	// ADR-030 Decision 0 ④: phrases never reach a dictionary today
	// (Decision 8 is what would change that), so the only way to learn
	// how many of them ECDICT/Wiktionary could have answered is to record
	// the selections and match them offline. Single words are skipped --
	// they already went through the dictionary path.
	dictsample.Phrase(req.Word)

	english, ok := h.english(c)
	if !ok {
		return
	}
	call := wordcontext.Call
	if english {
		call = wordcontext.CallEnglish
	}
	definition := effectiveDefinition(req.DictionaryDefinition, req.DictionaryChinese)

	var res wordcontext.Result
	ok = h.billedCall(c, "translate_word_in_context", func(ctx context.Context) (Usage, error) {
		var u Usage
		var err error
		res, u, err = observe(h.provider, "word_in_context", func() (wordcontext.Result, Usage, error) {
			return retryParse(ctx, h.provider.ParseAttempts, h.provider.Chat, func(ctx context.Context, chat llm.Chat) (wordcontext.Result, Usage, error) {
				return call(ctx, chat, req.Sentence, req.Word, definition)
			})
		})
		// After the retries: a Chinese reply is not asked for again.
		if err == nil && english {
			err = wordcontext.CheckEnglish(res, req.Sentence, req.Word)
		}
		return u, err
	})
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "chinese": res.WordChinese, "why": res.Why})
}

// TranslateSentenceWithWords handles POST /api/translate/sentence-with-words
// (ADR-023 Decision 9): one LLM call returns the sentence translation plus an
// in-context gloss for every word the sentence card absorbed. It replaced
// ADR-014's single-word endpoint, which no released extension ever called
// (#1135). Words are deduplicated by normalized text (first occurrence
// kept), so the response echoes them in request order. A gloss the model omitted comes back
// with empty chinese and why; the client falls back to an individual
// word-in-context call for it. A missing sentence translation is a 502 and is
// still billed for the tokens it used (ADR-094).
func (h *Handler) TranslateSentenceWithWords(c *gin.Context) {
	var req sentenceWithWordsRequest
	dec := json.NewDecoder(c.Request.Body)
	if dec.Decode(&req) != nil || strings.TrimSpace(req.Sentence) == "" {
		httpjson.Fail(c, http.StatusBadRequest, "sentence and at least one word are required")
		return
	}
	if _, err := dec.Token(); err != io.EOF {
		httpjson.Fail(c, http.StatusBadRequest, "sentence and at least one word are required")
		return
	}
	inputs := make([]sentenceword.WordInput, 0, len(req.Words))
	for _, w := range req.Words {
		inputs = append(inputs, sentenceword.WordInput{
			Word:                 w.Word,
			DictionaryDefinition: effectiveDefinition(w.DictionaryDefinition, w.DictionaryChinese),
		})
	}
	words := sentenceword.DedupeWords(inputs)
	if len(words) == 0 {
		httpjson.Fail(c, http.StatusBadRequest, "sentence and at least one word are required")
		return
	}

	english, ok := h.english(c)
	if !ok {
		return
	}
	call := sentenceword.CallWords
	if english {
		call = sentenceword.CallEnglishWords
	}

	var res sentenceword.WordsResult
	ok = h.billedCall(c, "translate_sentence_with_word", func(ctx context.Context) (Usage, error) {
		var u Usage
		var err error
		res, u, err = observe(h.provider, "sentence_with_words", func() (sentenceword.WordsResult, Usage, error) {
			return call(ctx, h.provider.Chat, req.Sentence, words)
		})
		if err == nil && english {
			res, err = sentenceword.CheckEnglish(res, req.Sentence)
		}
		return u, err
	})
	if !ok {
		return
	}
	out := make([]gin.H, len(res.Words))
	for i, w := range res.Words {
		out[i] = gin.H{"word": w.Word, "chinese": w.Chinese, "why": w.Why}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "chinese": res.SentenceChinese, "words": out})
}
