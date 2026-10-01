package dictionary

import (
	"context"
	"errors"
	"regexp"
	"time"

	"enx-api/utils/logger"
)

// The AI word fallback (ADR-045): when neither the words table nor ECDICT
// knows a word, a user who may use AI can have the word defined by a model.
// Only the word goes to the model -- no sentence -- and a confident answer is
// cached in the words table for everyone with AI.

// What DefineWithAI answers with, beyond the sources Resolve reports.
const (
	// SourceAI: the AI defined the word.
	SourceAI Source = "ai"
	// SourceAIMiss: the AI could not (not a word, or its reply was unusable).
	SourceAIMiss Source = "ai_miss"
)

var (
	// ErrAIUnavailable: the fallback is not configured, or has no price.
	ErrAIUnavailable = errors.New("dictionary: AI word lookup is not available")
	// ErrInvalidWord: the word does not have the shape of an English word.
	ErrInvalidWord = errors.New("dictionary: not a word the AI fallback accepts")
	// ErrNotEntitled: the user may not use AI (ADR-045 Decision 14).
	ErrNotEntitled = errors.New("dictionary: user may not use AI lookups")
	// ErrRateLimited: the user is over a per-minute or daily AI limit.
	ErrRateLimited = errors.New("dictionary: AI lookup rate limit reached")
	// ErrInsufficientCredit: the user has no credit left to spend.
	ErrInsufficientCredit = errors.New("dictionary: insufficient credit for an AI lookup")
	// ErrAIFailed: the model call itself failed. Nothing is charged.
	ErrAIFailed = errors.New("dictionary: AI lookup failed")
	// ErrInvalidAIReply is returned by a WordDefiner when the model answered
	// but not with a usable definition.
	ErrInvalidAIReply = errors.New("dictionary: the AI's reply was not usable")
)

// maxAIWordLen is the longest word sent to the AI; ECDICT's own word column
// is 64 characters, and nothing real needs more than this.
const maxAIWordLen = 40

// aiWordShape: letters only, with apostrophes and hyphens allowed between
// letters. No spaces, digits or other characters -- the only thing that
// reaches the model is a word-shaped token (ADR-045 Decision 4).
var aiWordShape = regexp.MustCompile(`^[A-Za-z]+(?:['-][A-Za-z]+)*$`)

// ValidAIWord reports whether english may be sent to the AI. Callers pass the
// canonical spelling (straight apostrophes).
func ValidAIWord(english string) bool {
	return len(english) <= maxAIWordLen && aiWordShape.MatchString(english)
}

// AIUsage is the token count a model call used.
type AIUsage struct {
	PromptTokens     int
	CompletionTokens int
}

// Definition is a model's checked answer for one word. Chinese is the text to
// store, already assembled from the checked senses.
type Definition struct {
	IsWord  bool
	Quality int
	Chinese string
}

// WordDefiner asks a model to define one word with no sentence. It returns an
// error wrapping ErrInvalidAIReply when the model answered unusably (the usage
// is still reported), and any other error when the call itself failed.
type WordDefiner interface {
	DefineWord(ctx context.Context, word string) (Definition, AIUsage, error)
}

// AIBilling charges a user for AI lookups by the tokens they used.
type AIBilling interface {
	// Priced reports whether the feature has a price; an unpriced feature
	// must not run, or it would be free.
	Priced() bool
	Balance(ctx context.Context, userID string) (int64, error)
	Settle(ctx context.Context, userID string, usage AIUsage) error
}

// AILimiter is the safety valve on AI spend and on writes to the shared cache.
// Each method counts the use it allows.
type AILimiter interface {
	// AllowCall: may userID make another model call now?
	AllowCall(userID string) bool
	// AllowCacheWrite: may userID add another AI definition to the cache today?
	AllowCacheWrite(userID string) bool
}

// AIConfig tunes the fallback. The values are starting guesses (ADR-045).
type AIConfig struct {
	// MinQuality: a definition is cached only if the model's confidence is at
	// least this (0-10).
	MinQuality int
	// PromptVersion is stored with every cached definition.
	PromptVersion string
	// CallTimeout bounds the model call. The call is deliberately not tied to
	// the client connection (see DefineWithAI), so it needs its own bound.
	CallTimeout time.Duration
}

type aiFallback struct {
	definer WordDefiner
	billing AIBilling
	limiter AILimiter
	cfg     AIConfig
}

// EnableAI switches the AI word fallback on. Without it DefineWithAI returns
// ErrAIUnavailable.
func (s *Service) EnableAI(definer WordDefiner, billing AIBilling, limiter AILimiter, cfg AIConfig) {
	if cfg.CallTimeout <= 0 {
		cfg.CallTimeout = 45 * time.Second
	}
	s.ai = &aiFallback{definer: definer, billing: billing, limiter: limiter, cfg: cfg}
}

// AIConfigured reports whether the AI fallback can run at all: a definer is
// wired and the feature is priced.
func (s *Service) AIConfigured() bool {
	return s.ai != nil && s.ai.definer != nil && s.ai.billing.Priced()
}

// DefineWithAI defines english with a model, for a user the first lookup
// (Resolve) found nothing for. It is the second request of the two-stage
// lookup and does not meter a lookup: Resolve already did.
//
// It re-checks the caches first, so a repeated or hand-made request never
// pays for a word that is already known. The model call is detached from
// ctx on purpose: once a request has been sent it runs to the end, is billed,
// and is cached even if the client has gone, so "was I charged?" has no
// in-between answer and the user's next lookup of the word is instant.
//
// Charging: a successful model call is billed by its tokens, including the
// answer "not a word". A call that fails, and a reply that cannot be used,
// are not billed -- those are not the user's doing.
func (s *Service) DefineWithAI(ctx context.Context, english, userID string) (Result, error) {
	if !s.AIConfigured() {
		return Result{}, ErrAIUnavailable
	}
	if !ValidAIWord(english) {
		return Result{}, ErrInvalidWord
	}
	canUse, err := s.ent.CanUseAI(ctx, userID)
	if err != nil {
		return Result{}, err
	}
	if !canUse {
		return Result{}, ErrNotEntitled
	}

	if res, known, err := s.alreadyKnown(ctx, english); err != nil || known {
		return res, err
	}

	if !s.ai.limiter.AllowCall(userID) {
		return Result{}, ErrRateLimited
	}
	balance, err := s.ai.billing.Balance(ctx, userID)
	if err != nil {
		return Result{}, err
	}
	if balance < 1 {
		return Result{}, ErrInsufficientCredit
	}

	callCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.ai.cfg.CallTimeout)
	defer cancel()

	def, usage, err := s.ai.definer.DefineWord(callCtx, english)
	switch {
	case errors.Is(err, ErrInvalidAIReply):
		logger.Warnf("dictionary: unusable AI reply for %q (user %s, %d+%d tokens, not billed): %v",
			english, userID, usage.PromptTokens, usage.CompletionTokens, err)
		return Result{English: english, Source: SourceAIMiss}, nil
	case err != nil:
		logger.Errorf("dictionary: AI lookup of %q failed for user %s: %v", english, userID, err)
		return Result{}, ErrAIFailed
	}

	if err := s.ai.billing.Settle(callCtx, userID, usage); err != nil {
		// The user still gets the answer they waited for.
		logger.Errorf("dictionary: could not bill user %s for an AI lookup (%d+%d tokens): %v",
			userID, usage.PromptTokens, usage.CompletionTokens, err)
	}

	if !def.IsWord {
		return Result{English: english, Source: SourceAIMiss}, nil
	}
	return s.keepAIDefinition(callCtx, english, userID, def), nil
}

// alreadyKnown answers from the words table or ECDICT when either has the
// word, so the AI is only asked about words nobody else knows. known is false
// on a clean miss from both; ECDICT being down or slow is reported as a
// result without a definition, not as a miss, because the AI must not paper
// over a dictionary that merely could not answer.
func (s *Service) alreadyKnown(ctx context.Context, english string) (res Result, known bool, err error) {
	id, entry, ok, err := s.words.Find(ctx, english, true)
	if err != nil {
		return Result{}, false, err
	}
	if ok {
		return Result{
			ID:            id,
			English:       english,
			Chinese:       entry.Chinese,
			Pronunciation: entry.Pronunciation,
			Source:        SourceLocal,
			Origin:        originOrECDICT(entry.Origin),
		}, true, nil
	}
	if !s.external.Available() {
		return Result{}, false, ErrEcdictUnavailable
	}
	res = s.fromExternal(ctx, english)
	return res, res.Source != SourceMiss, nil
}

// keepAIDefinition answers with the model's definition and, when it is
// confident enough and the user has not hit their daily cache limit, caches
// it in the words table. An uncached definition has no row id, so it is shown
// but not recorded in the user's vocabulary.
func (s *Service) keepAIDefinition(ctx context.Context, english, userID string, def Definition) Result {
	res := Result{
		English: english,
		Chinese: def.Chinese,
		Source:  SourceAI,
		Origin:  OriginAI,
	}
	if def.Quality < s.ai.cfg.MinQuality || !s.ai.limiter.AllowCacheWrite(userID) {
		return res
	}
	id, err := s.words.Add(ctx, Entry{
		English:       english,
		Chinese:       def.Chinese,
		Origin:        OriginAI,
		Quality:       def.Quality,
		PromptVersion: s.ai.cfg.PromptVersion,
	})
	if err != nil {
		logger.Errorf("dictionary: could not cache the AI definition of %s: %v", english, err)
		return res
	}
	res.ID = id
	return res
}
