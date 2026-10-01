// Package adapters implements the dictionary domain's ports on top of the
// application's storage: the words table and ECDICT. It sits outside
// package dictionary because repo/enx sit downstream of it in the import
// graph (dictionary -> stats -> middleware -> enx -> repo).
package adapters

import (
	"context"
	"errors"
	"fmt"

	"enx-api/aitranslate"
	"enx-api/aitranslate/worddef"
	"enx-api/billing/credit"
	"enx-api/dictionary"
	"enx-api/ecdict"
	"enx-api/preferences"
	"enx-api/repo"
	"enx-api/utils/logger"
)

// WordsTable is the dictionary.WordStore backed by the words table.
type WordsTable struct{}

func (WordsTable) Find(_ context.Context, english string, includeAI bool) (string, dictionary.Entry, bool, error) {
	w := repo.FindWordForLookup(english, includeAI)
	if w.Id == "" {
		return "", dictionary.Entry{}, false, nil
	}
	return w.Id, dictionary.Entry{
		English:       w.English,
		Chinese:       w.Chinese,
		Pronunciation: w.Pronunciation,
		Origin:        dictionary.Origin(w.Source),
	}, true, nil
}

func (WordsTable) Add(_ context.Context, entry dictionary.Entry) (string, error) {
	row := repo.Word{
		English:       entry.English,
		Chinese:       entry.Chinese,
		Pronunciation: entry.Pronunciation,
		Source:        repo.WordSourceECDICT,
	}
	if entry.Origin == dictionary.OriginAI {
		quality, version := entry.Quality, entry.PromptVersion
		row.Source = repo.WordSourceAI
		row.AIQuality = &quality
		row.AIPromptVersion = &version
	}
	if err := repo.InsertWord(&row); err != nil {
		// words.english is UNIQUE: the headword is already cached.
		existing := repo.GetWordByEnglish(entry.English)
		if existing.Id == "" {
			return "", err
		}
		return existing.Id, nil
	}
	return row.Id, nil
}

// Ecdict is the dictionary.ExternalDictionary backed by ECDICT.
type Ecdict struct{}

func (Ecdict) Available() bool { return ecdict.IsAvailable() }

func (Ecdict) Lookup(ctx context.Context, english string) (dictionary.Entry, error) {
	row, _, err := ecdict.Find(ctx, english)
	switch {
	case errors.Is(err, ecdict.ErrNotFound):
		return dictionary.Entry{}, dictionary.ErrNotInDictionary
	case errors.Is(err, ecdict.ErrTimeout):
		return dictionary.Entry{}, dictionary.ErrExternalTimeout
	case err != nil:
		return dictionary.Entry{}, err
	}
	return dictionary.Entry{
		English:       row.Word,
		Chinese:       row.Translation,
		Pronunciation: row.Phonetic,
	}, nil
}

// AIDefiner is the dictionary.WordDefiner backed by a provider's DefineWord.
type AIDefiner struct {
	Definer aitranslate.WordDefiner
}

func (a AIDefiner) DefineWord(ctx context.Context, word string) (dictionary.Definition, dictionary.AIUsage, error) {
	res, u, err := a.Definer.DefineWord(ctx, word)
	usage := dictionary.AIUsage{PromptTokens: u.PromptTokens, CompletionTokens: u.CompletionTokens}
	switch {
	case errors.Is(err, worddef.ErrInvalidReply):
		return dictionary.Definition{}, usage, fmt.Errorf("%w: %v", dictionary.ErrInvalidAIReply, err)
	case err != nil:
		return dictionary.Definition{}, usage, err
	}
	return dictionary.Definition{IsWord: res.IsWord, Quality: res.Quality, Chinese: res.Chinese()}, usage, nil
}

// TokenBilling is the dictionary.AIBilling that charges the credit ledger by
// token usage, at Pricing.
type TokenBilling struct {
	Pricing credit.TokenPricing
	// Feature names the charge in the ledger.
	Feature string
}

func (b TokenBilling) Priced() bool { return b.Pricing.Priced() }

func (TokenBilling) Balance(ctx context.Context, userID string) (int64, error) {
	return credit.Balance(ctx, userID)
}

func (b TokenBilling) Settle(ctx context.Context, userID string, usage dictionary.AIUsage) error {
	cost := b.Pricing.Cost(usage.PromptTokens, usage.CompletionTokens)
	logger.Infof("dictionary: %s billed user=%s cost=%d", b.Feature, userID, cost)
	return credit.Settle(ctx, userID, b.Feature, cost)
}

// AIPolicy tells the lookup response what the AI fallback offers a user who
// just missed a word: whether they can use it, and whether it runs by itself.
type AIPolicy struct {
	// Service reports whether the fallback is wired and priced.
	Service interface{ AIConfigured() bool }
	// Entitlements is the shared "may this user use AI" judgement.
	Entitlements dictionary.Entitlements
	// Preferences supplies the user's switch.
	Preferences interface {
		Effective(ctx context.Context, userID string, key preferences.Key) (bool, error)
	}
}

// Fallback fails closed: a failed check means the user is offered nothing,
// never an AI call they did not ask for.
func (p AIPolicy) Fallback(ctx context.Context, userID string) (canUse, auto bool) {
	if !p.Service.AIConfigured() {
		return false, false
	}
	can, err := p.Entitlements.CanUseAI(ctx, userID)
	if err != nil || !can {
		if err != nil {
			logger.Warnf("dictionary: entitlement check failed for user %s, offering no AI fallback: %v", userID, err)
		}
		return false, false
	}
	on, err := p.Preferences.Effective(ctx, userID, preferences.AIWordFallback)
	if err != nil {
		logger.Warnf("dictionary: preference read failed for user %s, not running the AI fallback by itself: %v", userID, err)
		return true, false
	}
	return true, on
}
