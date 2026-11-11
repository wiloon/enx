package dictionary

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"enx-api/dictionary/wordform"
	"enx-api/utils/logger"
)

// MaxBatchWords is the most raw entries one batch may name (ADR-079
// Decision 1).
const MaxBatchWords = 100

// ErrInvalidBatch: the batch is empty, names more than MaxBatchWords
// entries, or has an entry that is a sentence or nothing once normalized.
var ErrInvalidBatch = errors.New("dictionary: invalid batch")

// EntryStatus is how one word of a batch resolved.
type EntryStatus string

const (
	EntryFound    EntryStatus = "found"
	EntryNotFound EntryStatus = "not_found" // no dictionary knows the word
	// EntryFailed: no answer this time (a timeout, a source or store error,
	// ECDICT unavailable). Never passed off as not found.
	EntryFailed EntryStatus = "failed"
)

// AIFallbackOffer is what the AI word fallback offers a user who missed a
// word: CanUse, they may run it; Auto, it should start by itself.
type AIFallbackOffer struct {
	CanUse bool
	Auto   bool
}

// EntryResult is one distinct word of a batch.
type EntryResult struct {
	// Word is the normalized form the caller asked for. Result.English may
	// be a different headword ("ran" -> "run").
	Word   string
	Status EntryStatus
	// Result is set when Status is EntryFound; its ID is empty when the
	// ECDICT hit could not be cached.
	Result Result
	// AIFallback is set when Status is EntryNotFound and a policy exists.
	AIFallback *AIFallbackOffer
}

// Resolver resolves one normalized word for a user: Service in production.
type Resolver interface {
	Resolve(ctx context.Context, english, userID string) (Result, error)
}

// AIFallbackPolicy says what the AI fallback offers a user.
type AIFallbackPolicy interface {
	Fallback(ctx context.Context, userID string) (canUse, auto bool)
}

// LookedUpWords reads the user's non-deleted words with a positive query count,
// including known words, restricted to the normalized batch words.
type LookedUpWords interface {
	LookedUpWords(ctx context.Context, userID string, words []string) ([]string, error)
}

// Entries reads batch definitions without lookup events or query counts.
// Only words the user has not looked up consume quota (ADR-080).
type Entries struct {
	resolver Resolver
	lookedUp LookedUpWords
	meter    Meter
	policy   AIFallbackPolicy // nil: misses offer no AI fallback
}

func NewEntries(resolver Resolver, meter Meter, policy AIFallbackPolicy, lookedUp LookedUpWords) *Entries {
	return &Entries{resolver: resolver, meter: meter, policy: policy, lookedUp: lookedUp}
}

// Lookup normalizes raw like the lookup GET, drops exact duplicates, charges
// only distinct words userID has not looked up to quota, then resolves each, in
// the order first named. An invalid batch is ErrInvalidBatch and an
// over-quota one ErrQuotaExceeded; neither is charged or resolved. Any other
// meter error fails open (ADR-029 E2). Looked-up words match without case;
// a failed read charges the whole batch. An all-looked-up batch skips the meter.
func (e *Entries) Lookup(ctx context.Context, userID string, raw []string) ([]EntryResult, error) {
	words, err := distinctWords(raw)
	if err != nil {
		return nil, err
	}
	charge := len(words)
	if e.lookedUp != nil {
		lookedUp, readErr := e.lookedUp.LookedUpWords(ctx, userID, words)
		if readErr != nil {
			logger.Warnf("dictionary: looked-up words read failed for user %s, charging the whole batch: %v", userID, readErr)
		} else {
			seen := make(map[string]bool, len(lookedUp))
			for _, word := range lookedUp {
				seen[strings.ToLower(word)] = true
			}
			for _, word := range words {
				if seen[strings.ToLower(word)] {
					charge--
				}
			}
		}
	}
	if charge > 0 {
		if err := e.meter.Charge(ctx, userID, charge); errors.Is(err, ErrQuotaExceeded) {
			return nil, err
		} else if err != nil {
			logger.Warnf("dictionary: lookup quota charge failed for user %s, allowing the batch: %v", userID, err)
		}
	}

	var offer *AIFallbackOffer
	results := make([]EntryResult, len(words))
	for i, word := range words {
		results[i] = e.resolve(ctx, word, userID)
		if results[i].Status == EntryNotFound && e.policy != nil {
			if offer == nil {
				canUse, auto := e.policy.Fallback(ctx, userID)
				offer = &AIFallbackOffer{CanUse: canUse, Auto: auto}
			}
			results[i].AIFallback = offer
		}
	}
	return results, nil
}

func (e *Entries) resolve(ctx context.Context, word, userID string) EntryResult {
	res, err := e.resolver.Resolve(ctx, word, userID)
	switch {
	case errors.Is(err, ErrEcdictUnavailable):
		return EntryResult{Word: word, Status: EntryFailed}
	case err != nil:
		logger.Warnf("dictionary: batch lookup of %s failed: %v", word, err)
		return EntryResult{Word: word, Status: EntryFailed}
	}
	switch res.Source {
	case SourceLocal, SourceEcdict:
		return EntryResult{Word: word, Status: EntryFound, Result: res}
	case SourceMiss:
		return EntryResult{Word: word, Status: EntryNotFound}
	default:
		return EntryResult{Word: word, Status: EntryFailed}
	}
}

// distinctWords validates raw and returns its normalized words, each once.
func distinctWords(raw []string) ([]string, error) {
	if len(raw) == 0 || len(raw) > MaxBatchWords {
		return nil, fmt.Errorf("%w: %d entries, want 1 to %d", ErrInvalidBatch, len(raw), MaxBatchWords)
	}
	seen := make(map[string]bool, len(raw))
	words := make([]string, 0, len(raw))
	for _, entry := range raw {
		if strings.Contains(entry, " ") {
			return nil, fmt.Errorf("%w: %q is not a single word", ErrInvalidBatch, entry)
		}
		word := wordform.Normalize(entry)
		if word == "" {
			return nil, fmt.Errorf("%w: %q has no letters", ErrInvalidBatch, entry)
		}
		if !seen[word] {
			seen[word] = true
			words = append(words, word)
		}
	}
	return words, nil
}
