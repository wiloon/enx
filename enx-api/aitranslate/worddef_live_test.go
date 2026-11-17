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
// user content and parser on OpenRouter. Opt-in: it runs only when an
// OpenRouter API key is configured (OPENROUTER_API_KEY or config.toml), and
// honours SENTENCE_TRANSLATE_OPENROUTER_MODEL.
func TestLiveDefineWord(t *testing.T) {
	cfg, err := config.Load("")
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	if cfg.SentenceTranslate.OpenRouter.APIKey == "" {
		t.Skip("no OpenRouter API key configured (OPENROUTER_API_KEY); live define-word test skipped")
	}
	cfg.SentenceTranslate.Provider = "openrouter"

	ctx := context.Background()
	translator, err := aitranslate.New(ctx, cfg.SentenceTranslate)
	if err != nil {
		t.Fatalf("aitranslate.New: %v", err)
	}
	definer, ok := aitranslate.AsWordDefiner(translator)
	if !ok {
		t.Fatal("the openrouter provider does not define words")
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
