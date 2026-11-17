package aitranslate_test

import (
	"context"
	"testing"
	"time"

	"enx-api/aitranslate"
	"enx-api/config"
)

// defineWordSamples are words the AI word fallback (ADR-045) is asked about
// because no dictionary has them.
var defineWordSamples = []struct {
	word   string
	isWord bool
}{
	// Hyphenated compounds an author coins from real words. No dictionary
	// lists them, yet their meaning is plain from their parts.
	{word: "mind-set-changing", isWord: true},
	{word: "life-affirming", isWord: true},
	{word: "rain-soaked", isWord: true},
	// Gibberish stays "not a word", hyphenated or not.
	{word: "blorf-snizzle", isWord: false},
	{word: "qzxvbn", isWord: false},
}

// TestLiveDefineWord sends words through the production define-word prompt,
// user content and parser, on every provider that has an API key configured:
// OpenRouter (OPENROUTER_API_KEY, production's route) and DeepSeek directly
// (DEEPSEEK_API_KEY). Opt-in: with neither key it is skipped. The model
// overrides (SENTENCE_TRANSLATE_*_MODEL) are honoured.
func TestLiveDefineWord(t *testing.T) {
	cfg, err := config.Load("")
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	keys := map[string]config.Secret{
		"openrouter": cfg.SentenceTranslate.OpenRouter.APIKey,
		"deepseek":   cfg.SentenceTranslate.DeepSeek.APIKey,
	}
	ran := false
	for _, provider := range []string{"openrouter", "deepseek"} {
		if keys[provider] == "" {
			continue
		}
		ran = true
		t.Run(provider, func(t *testing.T) {
			pcfg := cfg.SentenceTranslate
			pcfg.Provider = provider
			defineWordSamplesOn(t, pcfg)
		})
	}
	if !ran {
		t.Skip("no OpenRouter or DeepSeek API key configured; live define-word test skipped")
	}
}

func defineWordSamplesOn(t *testing.T, cfg config.SentenceTranslate) {
	ctx := context.Background()
	translator, err := aitranslate.New(ctx, cfg)
	if err != nil {
		t.Fatalf("aitranslate.New: %v", err)
	}
	definer, ok := aitranslate.AsWordDefiner(translator)
	if !ok {
		t.Fatalf("the %s provider does not define words", cfg.Provider)
	}

	for _, s := range defineWordSamples {
		t.Run(s.word, func(t *testing.T) {
			callCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
			defer cancel()

			got, _, err := definer.DefineWord(callCtx, s.word)
			if err != nil {
				t.Fatalf("DefineWord: %v", err)
			}
			t.Logf("%s -> is_word=%v quality=%d\n%s", s.word, got.IsWord, got.Quality, got.Chinese())
			if got.IsWord != s.isWord {
				t.Errorf("is_word = %v, want %v", got.IsWord, s.isWord)
			}
		})
	}
}
