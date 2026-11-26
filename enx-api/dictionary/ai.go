package dictionary

import (
	"context"
	"errors"
	"regexp"
	"time"

	"enx-api/ailimit"
	"enx-api/utils/logger"
)

// The AI word fallback (ADR-045): when neither the words table nor ECDICT
// knows a word, a user who may use AI can have the word defined by a model.
// Only the word goes to the model -- no sentence -- and a confident answer is
// cached in the words table for everyone with AI.

// AIFeature names the AI word fallback in the credit ledger and the logs.
const AIFeature = "lookup_word_ai"

// What DefineWithAI answers with, beyond the sources Resolve reports.
const (
	// SourceAI: the AI defined the word.
	SourceAI Source = "ai"
	// SourceAIMiss: there is no AI definition (the model says it is not a
	// word, or its candidate definition was rejected).
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
	// ErrTrialLimitedPerDay / ErrTrialLimitedPerMinute: a user whose AI
	// access comes from the sign-up trial alone is over the trial's call
	// rate (ADR-048 Decision 7).
	ErrTrialLimitedPerDay    = errors.New("dictionary: trial daily AI limit reached")
	ErrTrialLimitedPerMinute = errors.New("dictionary: trial per-minute AI limit reached")
	// ErrInsufficientCredit: the user has no credit left to spend.
	ErrInsufficientCredit = errors.New("dictionary: insufficient credit for an AI lookup")
	// ErrAIFailed: the model call itself failed. Tokens it reported using are
	// still charged (ADR-094).
	ErrAIFailed = errors.New("dictionary: AI lookup failed")
	// ErrInvalidAIReply is returned by a WordDefiner when the model answered
	// but not with a usable definition.
	ErrInvalidAIReply = errors.New("dictionary: the AI's reply was not usable")
	// ErrDictionaryFailed: ECDICT timed out or failed, so there is no telling
	// whether the word is missing and the model is not called.
	ErrDictionaryFailed = errors.New("dictionary: ECDICT could not answer")
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
// error wrapping ErrInvalidAIReply when the model answered unusably, and any
// other error when the call itself failed. Either way it reports the usage the
// provider did.
type WordDefiner interface {
	DefineWord(ctx context.Context, word string) (Definition, AIUsage, error)
}

// AIBilling charges a user for AI lookups by the tokens they used.
type AIBilling interface {
	// Priced reports whether the feature has a price; an unpriced feature
	// must not run, or it would be free.
	Priced() bool
	Balance(ctx context.Context, userID string) (int64, error)
	// Settle charges usage and returns the computed charge, also when the
	// charge could not be written.
	Settle(ctx context.Context, userID string, usage AIUsage) (cost int64, err error)
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

// TrialGate holds trial-only users to the trial's call rate; production is
// an *ailimit.TrialGate.
type TrialGate interface {
	Check(ctx context.Context, userID string) ailimit.Verdict
}

type aiFallback struct {
	definer    WordDefiner
	billing    AIBilling
	limiter    AILimiter
	trialGate  TrialGate
	cfg        AIConfig
	candidates CandidateStore
}

// CandidateStatus is where an AI candidate definition stands (ADR-091).
type CandidateStatus string

const (
	CandidatePending  CandidateStatus = "pending"
	CandidateRejected CandidateStatus = "rejected"
)

// Candidate is an AI candidate definition: an AI answer that was not written
// to words, kept for every AI-eligible user and for an admin to review
// (ADR-091). It has no user.
type Candidate struct {
	English       string
	Chinese       string
	Quality       int
	PromptVersion string
	Status        CandidateStatus
	HitCount      int
	FirstHitAt    time.Time
	LastHitAt     time.Time
}

// CandidateStore is the AI candidate table plus the one guarded write into
// words that must agree with it (ADR-091 Decision 9).
type CandidateStore interface {
	// FindCandidate returns the candidate for english (case-insensitive).
	FindCandidate(ctx context.Context, english string) (c Candidate, ok bool, err error)
	// HitCandidate adds 1 to the hit count and sets the last hit time, atomically.
	HitCandidate(ctx context.Context, english string) error
	// AddCandidate inserts c with hit count 1. On conflict with an existing
	// row it keeps that row's status and definition and only counts a hit; it
	// returns affected=false when words has a live row for the word.
	AddCandidate(ctx context.Context, c Candidate) (affected bool, err error)
	// AddAIWord is the qualifying write into words. With a rejected candidate
	// it writes nothing (stored false); with a pending one it inserts the row
	// and deletes the candidate; with a live words row it leaves that row
	// alone and returns its id.
	AddAIWord(ctx context.Context, entry Entry) (id string, stored bool, err error)
}

// ErrCandidateNotFound: the admin named a candidate that is not there (it was
// approved, or never existed).
var ErrCandidateNotFound = errors.New("AI candidate definition not found")

// AIWordRecorder counts the outcome of each DefineWithAI call
// (enx_ai_word_fallback_total).
type AIWordRecorder interface {
	RecordAIWordOutcome(outcome string)
}

// What DefineWithAI reports to the recorder, once per call (ADR-091 Decision 8).
const (
	outcomeKnown           = "known"
	outcomeCandidateHit    = "candidate_hit"
	outcomeRejectedHit     = "rejected_hit"
	outcomeStored          = "stored"
	outcomeCandidateStored = "candidate_stored"
	outcomeUnstored        = "unstored"
	outcomeNotAWord        = "not_a_word"
	outcomeInvalidReply    = "invalid_reply"
	outcomeRefused         = "refused"
	outcomeFailed          = "failed"
)

// UseCandidates keeps definitions that are not cached as AI candidate
// definitions. Call it after EnableAI; without it they are shown and dropped.
func (s *Service) UseCandidates(store CandidateStore) {
	if s.ai != nil {
		s.ai.candidates = store
	}
}

// RecordAIWordOutcomes reports each DefineWithAI outcome to rec, even when
// the AI fallback is unavailable.
func (s *Service) RecordAIWordOutcomes(rec AIWordRecorder) {
	s.aiRecorder = rec
}

// EnableAI switches the AI word fallback on. Without it DefineWithAI returns
// ErrAIUnavailable.
func (s *Service) EnableAI(definer WordDefiner, billing AIBilling, limiter AILimiter, cfg AIConfig) {
	if cfg.CallTimeout <= 0 {
		cfg.CallTimeout = 45 * time.Second
	}
	s.ai = &aiFallback{definer: definer, billing: billing, limiter: limiter, cfg: cfg}
}

// LimitTrial turns on the trial call-rate limit for the AI fallback. Call it
// after EnableAI; without it no trial limit applies.
func (s *Service) LimitTrial(gate TrialGate) {
	if s.ai != nil {
		s.ai.trialGate = gate
	}
}

// AIConfigured reports whether the AI fallback can run at all: a definer is
// wired and the feature is priced.
func (s *Service) AIConfigured() bool {
	return s.ai != nil && s.ai.definer != nil && s.ai.billing.Priced()
}

// DefineWithAI defines english with a model, for a user the first lookup
// (Resolve) found nothing for. It is the second request of the two-stage
// lookup and does not meter a lookup: the request that resolved the miss
// already charged the quota.
//
// It re-checks the caches first, so a repeated or hand-made request never
// pays for a word that is already known. The model call is detached from
// ctx on purpose: once a request has been sent it runs to the end, is billed,
// and is cached even if the client has gone, so "was I charged?" has no
// in-between answer and the user's next lookup of the word is instant.
//
// Charging (ADR-094): a model call is billed by the tokens it used, whether it
// answered, said "not a word", gave an unusable reply or failed. A failure
// that reports no tokens is not billed.
func (s *Service) DefineWithAI(ctx context.Context, english, userID string) (Result, error) {
	res, outcome, err := s.defineWithAI(ctx, english, userID)
	if s.aiRecorder != nil {
		s.aiRecorder.RecordAIWordOutcome(outcome)
	}
	return res, err
}

func (s *Service) defineWithAI(ctx context.Context, english, userID string) (Result, string, error) {
	if !s.AIConfigured() {
		return Result{}, outcomeFailed, ErrAIUnavailable
	}
	if !ValidAIWord(english) {
		return Result{}, outcomeRefused, ErrInvalidWord
	}
	canUse, err := s.ent.CanUseAI(ctx, userID)
	if err != nil {
		return Result{}, outcomeFailed, err
	}
	if !canUse {
		return Result{}, outcomeRefused, ErrNotEntitled
	}

	res, err := s.lookupDictionaries(ctx, english)
	if err != nil {
		return res, outcomeFailed, err
	}
	switch res.Source {
	case SourceLocal, SourceEcdict:
		return res, outcomeKnown, nil
	case SourceMiss:
		// Only a clean miss can fall through to candidate and model lookups.
	default:
		return Result{}, outcomeFailed, ErrDictionaryFailed
	}

	if res, outcome, done, err := s.answerFromCandidate(ctx, english); done {
		return res, outcome, err
	}

	if !s.ai.limiter.AllowCall(userID) {
		return Result{}, outcomeRefused, ErrRateLimited
	}
	balance, err := s.ai.billing.Balance(ctx, userID)
	if err != nil {
		return Result{}, outcomeFailed, err
	}
	if balance < 1 {
		return Result{}, outcomeRefused, ErrInsufficientCredit
	}
	if s.ai.trialGate != nil {
		switch s.ai.trialGate.Check(ctx, userID) {
		case ailimit.LimitedPerDay:
			return Result{}, outcomeRefused, ErrTrialLimitedPerDay
		case ailimit.LimitedPerMinute:
			return Result{}, outcomeRefused, ErrTrialLimitedPerMinute
		}
	}

	callCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.ai.cfg.CallTimeout)
	defer cancel()

	def, usage, err := s.ai.definer.DefineWord(callCtx, english)
	if err != nil {
		s.settleFailedAICall(callCtx, userID, usage, err)
		if errors.Is(err, ErrInvalidAIReply) {
			return Result{}, outcomeInvalidReply, ErrInvalidAIReply
		}
		return Result{}, outcomeFailed, ErrAIFailed
	}

	// The user still gets the answer they waited for if the charge fails.
	_, _ = s.settleAIUsage(callCtx, userID, usage)

	if !def.IsWord {
		return Result{English: english, Source: SourceAIMiss}, outcomeNotAWord, nil
	}
	res, outcome := s.keepAIDefinition(callCtx, english, userID, def)
	return res, outcome, nil
}

// settleAIUsage charges userID for usage, logging a charge that could not be
// written.
func (s *Service) settleAIUsage(ctx context.Context, userID string, usage AIUsage) (int64, error) {
	cost, err := s.ai.billing.Settle(ctx, userID, usage)
	if err != nil {
		logger.Errorf("dictionary: could not bill user %s for an AI lookup (%d+%d tokens): %v",
			userID, usage.PromptTokens, usage.CompletionTokens, err)
	}
	return cost, err
}

// settleFailedAICall bills and logs a model call that returned callErr
// (ADR-094). With nonzero usage the model ran, so its tokens are settled and
// ai_call_billed_on_failure tells a log review whom to compensate. With zero
// usage nothing is charged and ai_call_failed_unbilled alerts ops.
func (s *Service) settleFailedAICall(ctx context.Context, userID string, usage AIUsage, callErr error) {
	// Test the tokens, not the cost: a cost floors at 1 even for no tokens.
	if usage.PromptTokens <= 0 && usage.CompletionTokens <= 0 {
		logger.Errorw("ai_call_failed_unbilled", "feature", AIFeature, "user_id", userID, "error", callErr.Error())
		return
	}
	cost, settleErr := s.settleAIUsage(ctx, userID, usage)
	logger.Errorw("ai_call_billed_on_failure",
		"feature", AIFeature, "user_id", userID,
		"prompt_tokens", usage.PromptTokens, "completion_tokens", usage.CompletionTokens,
		"cost", cost, "settled", settleErr == nil, "error", callErr.Error())
}

// answerFromCandidate answers from the AI candidate table (ADR-091): a pending
// candidate is served as today's uncached AI definition, a rejected one as "no
// definition". Neither calls the AI or charges. done is false on a clean miss
// or when no store is wired.
func (s *Service) answerFromCandidate(ctx context.Context, english string) (res Result, outcome string, done bool, err error) {
	if s.ai.candidates == nil {
		return Result{}, "", false, nil
	}
	c, ok, err := s.ai.candidates.FindCandidate(ctx, english)
	if err != nil {
		return Result{}, outcomeFailed, true, err
	}
	if !ok {
		return Result{}, "", false, nil
	}
	if err := s.ai.candidates.HitCandidate(ctx, english); err != nil {
		logger.Errorf("dictionary: could not count a hit on the AI candidate %q: %v", english, err)
	}
	if c.Status == CandidateRejected {
		return Result{English: english, Source: SourceAIMiss}, outcomeRejectedHit, true, nil
	}
	return Result{English: english, Chinese: c.Chinese, Source: SourceAI, Origin: OriginAI}, outcomeCandidateHit, true, nil
}

// lookupDictionaries checks the words table and ECDICT before AI fallback.
// Only a clean miss from both allows fallback.
func (s *Service) lookupDictionaries(ctx context.Context, english string) (Result, error) {
	id, entry, ok, err := s.words.Find(ctx, english, true)
	if err != nil {
		return Result{}, err
	}
	if ok {
		return Result{
			ID:            id,
			English:       english,
			Chinese:       entry.Chinese,
			Pronunciation: entry.Pronunciation,
			Source:        SourceLocal,
			Origin:        originOrECDICT(entry.Origin),
		}, nil
	}
	if !s.external.Available() {
		return Result{}, ErrEcdictUnavailable
	}
	return s.fromExternal(ctx, english), nil
}

// keepAIDefinition answers with the model's definition. When it is confident
// enough and the user has not hit their daily cache limit it is cached in the
// words table; otherwise it is kept as an AI candidate definition (ADR-091).
// An uncached definition has no row id, so it is shown but not recorded in the
// user's vocabulary. The string is the outcome for the recorder.
func (s *Service) keepAIDefinition(ctx context.Context, english, userID string, def Definition) (Result, string) {
	res := Result{
		English: english,
		Chinese: def.Chinese,
		Source:  SourceAI,
		Origin:  OriginAI,
	}
	entry := Entry{
		English:       english,
		Chinese:       def.Chinese,
		Origin:        OriginAI,
		Quality:       def.Quality,
		PromptVersion: s.ai.cfg.PromptVersion,
	}
	if def.Quality < s.ai.cfg.MinQuality || !s.ai.limiter.AllowCacheWrite(userID) {
		return res, s.keepCandidate(ctx, entry)
	}
	var (
		id     string
		stored = true
		err    error
	)
	if s.ai.candidates != nil {
		id, stored, err = s.ai.candidates.AddAIWord(ctx, entry)
	} else {
		id, err = s.words.Add(ctx, entry)
	}
	if err != nil {
		logger.Errorf("dictionary: could not cache the AI definition of %s: %v", english, err)
		return res, outcomeUnstored
	}
	if !stored {
		// An admin rejected the word while the model was answering.
		return res, outcomeUnstored
	}
	res.ID = id
	return res, outcomeStored
}

// keepCandidate stores an uncached definition as an AI candidate definition.
func (s *Service) keepCandidate(ctx context.Context, e Entry) string {
	if s.ai.candidates == nil {
		return outcomeUnstored
	}
	affected, err := s.ai.candidates.AddCandidate(ctx, Candidate{
		English:       e.English,
		Chinese:       e.Chinese,
		Quality:       e.Quality,
		PromptVersion: e.PromptVersion,
		Status:        CandidatePending,
		HitCount:      1,
	})
	if err != nil {
		logger.Errorf("dictionary: could not keep the AI candidate definition of %s: %v", e.English, err)
	}
	if err != nil || !affected {
		return outcomeUnstored
	}
	return outcomeCandidateStored
}
