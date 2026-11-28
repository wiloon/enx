package translate

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"enx-api/dictionary"
	dictionaryhttp "enx-api/dictionary/httpapi"
	"enx-api/enx"
	"enx-api/metrics"
	"enx-api/middleware"
	"enx-api/platform/httpjson"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// WordCounts reads a user's review state for a word: repo.WordCounts in
// production. It is read-only on purpose: the lookup endpoints never change
// the query count, POST /api/me/word-lookups does (ADR-059 Decision 3).
type WordCounts interface {
	CountAndKnown(userID, wordID string) (queryCount int, known bool, err error)
}

// AIDefiner defines a word the dictionaries lack: dictionary.Service in
// production (ADR-045 / ADR-098).
type AIDefiner interface {
	DefineWithAI(ctx context.Context, english, userID string, lang dictionary.Language) (dictionary.Result, error)
}

// AIPolicy says what the AI fallback offers a user: adapters.AIPolicy in
// production.
type AIPolicy interface {
	Fallback(ctx context.Context, userID string) (canUse, auto bool)
}

// Handler serves the word lookup endpoints.
type Handler struct {
	tiers   dictionary.QuotaTierSource
	dict    dictionary.Resolver
	meter   dictionary.Meter
	reviews WordCounts
	ai      AIDefiner
	policy  AIPolicy

	languages dictionary.ExplanationLanguages // nil: everyone is zh-Hans
}

func (h *Handler) WithQuotaTiers(tiers dictionary.QuotaTierSource) *Handler {
	h.tiers = tiers
	return h
}

func NewHandlerWithQuotaTiers(dict dictionary.Resolver, meter dictionary.Meter, reviews WordCounts, tiers dictionary.QuotaTierSource) *Handler {
	return &Handler{dict: dict, meter: meter, reviews: reviews, tiers: tiers}
}

// WithAI sets up the AI word fallback: ai answers POST /api/dictionary/ai-word
// and policy decides what a lookup that found nothing offers the user. Without
// it the lookup response says nothing about AI and the endpoint is not served.
func (h *Handler) WithAI(ai AIDefiner, policy AIPolicy) *Handler {
	h.ai, h.policy = ai, policy
	return h
}

// WithExplanationLanguages makes the endpoints, whose responses carry Chinese
// only, refuse users who want another explanation language (ADR-098).
func (h *Handler) WithExplanationLanguages(languages dictionary.ExplanationLanguages) *Handler {
	h.languages = languages
	return h
}

// wantsChinese reports whether userID may be answered in Chinese. A failed
// read is a no.
func (h *Handler) wantsChinese(c *gin.Context, userID string) bool {
	if h.languages == nil {
		return true
	}
	lang, err := h.languages.ExplanationLanguage(c.Request.Context(), userID)
	if err != nil {
		logger.Warnf("explanation language read failed for user %s, refusing the lookup: %v", userID, err)
		return false
	}
	return lang == dictionary.LanguageZhHans
}

// Translate handles GET /api/translate?word=
func (h *Handler) Translate(c *gin.Context) {
	h.translateWord(c, c.Query("word"))
}

// TranslateByWord handles GET /api/word/:word
func (h *Handler) TranslateByWord(c *gin.Context) {
	h.translateWord(c, c.Param("word"))
}

func (h *Handler) translateWord(c *gin.Context, raw string) {
	userId, ok := middleware.RequireUserID(c, "Invalid session")
	if !ok {
		logger.Errorf("no valid user id found in session")
		return
	}

	logger.Debugf("translate word: %s, user_id: %s", raw, userId)

	// Before the quota: a refused lookup costs nothing.
	if !h.wantsChinese(c, userId) {
		httpjson.Fail(c, http.StatusServiceUnavailable, "Please update Catglish to the latest version to look up words.")
		return
	}

	if isSentence(raw) {
		respondSentenceUnavailable(c, raw)
		return
	}

	word := enx.Word{}
	word.SetEnglish(raw)

	// ADR-079 Decision 7: one word, one charge, before it is resolved; no
	// lookup event (POST /api/me/word-lookups writes that).
	if err := h.meter.Charge(c.Request.Context(), userId, 1); errors.Is(err, dictionary.ErrQuotaExceeded) {
		dictionaryhttp.RespondQuotaExceeded(c, userId, h.tiers)
		return
	} else if err != nil {
		logger.Warnf("lookup quota charge failed for user %s, allowing lookup: %v", userId, err)
	}

	res, err := h.dict.Resolve(c.Request.Context(), word.English, userId, dictionary.LanguageZhHans)
	switch {
	case errors.Is(err, dictionary.ErrEcdictUnavailable):
		dictionaryhttp.RespondUnavailable(c)
		return
	case err != nil:
		// Only the sentinel above means something to the client; any
		// other error must never be passed off as "word not found" (#17).
		logger.Errorf("translate word %s: %v", word.English, err)
		httpjson.Fail(c, 502, "Dictionary lookup failed")
		return
	}

	// ADR-040: the metrics middleware records this request's latency under
	// the source that answered it.
	c.Set(metrics.LookupSourceKey, string(res.Source))

	word.Id = res.ID
	word.English = res.English
	word.Key = strings.ToLower(res.English)
	word.Chinese = res.Chinese
	word.Pronunciation = res.Pronunciation
	word.Origin = string(res.Origin)
	word.Source = string(res.Source)

	// The word's current review state, read only: this GET may be retried,
	// so it never adds to the query count (ADR-059 Decision 3). A miss has
	// no persisted word and so no state.
	if word.Id != "" {
		qc, known, err := h.reviews.CountAndKnown(userId, word.Id)
		if err != nil {
			// The definition is still worth answering with; the counts
			// stay at zero for this response.
			logger.Errorf("read review state of %s for %s: %v", word.English, userId, err)
		} else {
			word.LoadCount = qc
			word.Known = known
		}
	}

	// A lookup that found nothing tells the client what the AI fallback
	// offers this user, so it can run it, offer it, or point at billing.
	if res.Source == dictionary.SourceMiss && h.policy != nil {
		canUse, auto := h.policy.Fallback(c.Request.Context(), userId)
		word.AIFallback = &enx.AIFallback{CanUse: canUse, Auto: auto}
	}

	logger.Debugf("translate result: %+v", word)
	c.JSON(200, word)
}
