package translate

import (
	"errors"
	"net/http"
	"time"

	"enx-api/ailimit"
	"enx-api/aitranslate/aifailure"
	"enx-api/dictionary"
	dictionaryhttp "enx-api/dictionary/httpapi"
	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

type aiWordRequest struct {
	Word string `json:"word"`
}

// AIWord handles POST /api/dictionary/ai-word, the second request of the AI
// word fallback (ADR-045 / ADR-098): the client sends it after a lookup missed
// and told it the fallback is on. It answers 200 {"found": true, "word": {...}}
// with the same word payload as a lookup, or 200 {"found": false, ...} when the
// AI says it is not a word (or its candidate definition was rejected);
// everything else is a status code and a stable "code".
//
// The lookup request already counted against the daily lookup quota, so this
// one does not.
//
// The explanation language is read on the server: zh-Hans gets a Chinese
// definition, en an English-English one. A failed language read is 503
// ai_unavailable, never a Chinese answer by default (ADR-098).
func (h *Handler) AIWord(c *gin.Context) {
	userID, ok := middleware.RequireUserID(c, "Invalid session")
	if !ok {
		return
	}
	if h.ai == nil {
		respondAIError(c, dictionary.ErrAIUnavailable)
		return
	}
	var req aiWordRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Word == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "invalid_word", "message": "A word is required."})
		return
	}

	lang, err := h.explanationLanguage(c, userID)
	if err != nil {
		respondAIError(c, dictionary.ErrAIUnavailable)
		return
	}

	word := enx.Word{}
	word.SetEnglish(req.Word)

	res, err := h.ai.DefineWithAI(c.Request.Context(), word.English, userID, lang)
	if err != nil {
		respondAIError(c, err)
		return
	}

	switch res.Source {
	case dictionary.SourceAI, dictionary.SourceLocal, dictionary.SourceEcdict, dictionary.SourceWiktionary:
	default:
		// The AI had no definition.
		c.JSON(http.StatusOK, gin.H{"found": false, "reason": "no_definition"})
		return
	}

	word.Id = res.ID
	word.English = res.English
	word.Chinese = res.Chinese
	word.Pronunciation = res.Pronunciation
	word.Origin = string(res.Origin)

	// The word's current review state, as the lookup GET answers it. A word
	// with a row joins the vocabulary when the client records the lookup
	// with POST /api/me/word-lookups (ADR-059 Decision 3); one the AI was
	// not confident enough to store has no row and does not.
	if word.Id != "" {
		qc, known, err := h.reviews.CountAndKnown(userID, word.Id)
		if err != nil {
			logger.Errorf("read review state of AI word %s for %s: %v", word.English, userID, err)
		} else {
			word.LoadCount = qc
			word.Known = known
		}
	}
	// An unstored definition has no lookup count, including a zero count.
	var loadCount *int
	if word.Id != "" {
		loadCount = &word.LoadCount
	}

	if lang == dictionary.LanguageEnglish {
		c.JSON(http.StatusOK, gin.H{"found": true, "word": englishAIWordPayload(word, res, loadCount, lang)})
		return
	}

	payload := struct {
		enx.Word
		LoadCount *int `json:"LoadCount,omitempty"`
	}{Word: word, LoadCount: loadCount}
	c.JSON(http.StatusOK, gin.H{"found": true, "word": payload})
}

// englishAIWordPayload is the en AI-word envelope: entries definition fields
// plus ExplanationLanguage, with empty Chinese and Pronunciation.
func englishAIWordPayload(word enx.Word, res dictionary.Result, loadCount *int, lang dictionary.Language) any {
	type senseJSON struct {
		Pos     string `json:"pos"`
		Gloss   string `json:"gloss"`
		Example string `json:"example,omitempty"`
	}
	body := struct {
		Id                  string `json:",omitempty"`
		English             string
		Chinese             string
		Pronunciation       string
		Origin              string `json:",omitempty"`
		Source              string `json:",omitempty"`
		ExplanationLanguage dictionary.Language
		Senses              []senseJSON
		LemmaNote           string `json:",omitempty"`
		PronunciationUS     string `json:",omitempty"`
		PronunciationUK     string `json:",omitempty"`
		Known               bool
		LoadCount           *int `json:"LoadCount,omitempty"`
	}{
		Id:                  word.Id,
		English:             word.English,
		Origin:              word.Origin,
		Source:              string(res.Source),
		ExplanationLanguage: lang,
		Known:               word.Known,
		LoadCount:           loadCount,
	}
	if d := res.Definition; d != nil {
		body.LemmaNote = d.LemmaNote
		body.PronunciationUS = d.PronunciationUS
		body.PronunciationUK = d.PronunciationUK
		body.Senses = make([]senseJSON, len(d.Senses))
		for i, s := range d.Senses {
			body.Senses[i] = senseJSON{Pos: s.POS, Gloss: s.Gloss, Example: s.Example}
		}
	}
	return body
}

// explanationLanguage is the user's preferred explanation language. A missing
// languages dependency defaults to zh-Hans (tests and legacy wiring).
func (h *Handler) explanationLanguage(c *gin.Context, userID string) (dictionary.Language, error) {
	if h.languages == nil {
		return dictionary.LanguageZhHans, nil
	}
	lang, err := h.languages.ExplanationLanguage(c.Request.Context(), userID)
	if err != nil {
		logger.Warnf("explanation language read failed for user %s, refusing AI word: %v", userID, err)
		return "", err
	}
	return lang, nil
}

// respondAIError maps the AI fallback's errors to a status and a stable code.
// The messages are shown to users, so they are plain English and never carry
// an underlying error.
func respondAIError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, dictionary.ErrInvalidWord):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "invalid_word", "message": "That is not a word the AI lookup can define."})
	case errors.Is(err, dictionary.ErrNotEntitled):
		c.JSON(http.StatusForbidden, gin.H{"success": false, "code": "not_entitled", "message": "AI lookup is available with a subscription or a credit balance."})
	case errors.Is(err, dictionary.ErrInsufficientCredit):
		c.JSON(http.StatusPaymentRequired, gin.H{"success": false, "code": "insufficient_credit", "message": "Insufficient credit. Please add credit or subscribe."})
	case errors.Is(err, dictionary.ErrRateLimited):
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "code": "rate_limited", "message": "Too many AI lookups. Please try again in a moment."})
	case errors.Is(err, dictionary.ErrTrialLimitedPerDay):
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "code": "trial_limit_day", "message": ailimit.DayLimitMessage(time.Now())})
	case errors.Is(err, dictionary.ErrTrialLimitedPerMinute):
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "code": "trial_limit_minute", "message": "Too many requests. Please wait a minute and try again."})
	case errors.Is(err, dictionary.ErrAIUnavailable), errors.Is(err, dictionary.ErrWiktionaryUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "code": "ai_unavailable", "message": "AI lookup is not available right now."})
	case errors.Is(err, dictionary.ErrEcdictUnavailable):
		dictionaryhttp.RespondUnavailable(c)
	case errors.Is(err, dictionary.ErrAIFailed), errors.Is(err, dictionary.ErrInvalidAIReply):
		aifailure.Upstream(c)
	default:
		logger.Errorf("AI word lookup: %v", err)
		aifailure.Internal(c)
	}
}
