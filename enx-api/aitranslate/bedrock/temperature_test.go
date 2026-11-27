package bedrock

import (
	"context"
	"testing"

	"enx-api/aitranslate/sentence"
	"enx-api/aitranslate/sentenceword"
	"enx-api/aitranslate/wordcontext"
)

// Converse requests set no temperature, whatever the feature asks for.
func TestNoFeatureSendsATemperature(t *testing.T) {
	ctx := context.Background()
	for name, call := range map[string]func(*Bedrock){
		"sentence":        func(b *Bedrock) { _, _, _ = sentence.Call(ctx, b.Chat, "Hello") },
		"word in context": func(b *Bedrock) { _, _, _ = wordcontext.Call(ctx, b.Chat, "Hello", "Hello", "") },
		"sentence with words": func(b *Bedrock) {
			_, _, _ = sentenceword.CallWords(ctx, b.Chat, "Hello", []sentenceword.WordInput{{Word: "Hello"}})
		},
	} {
		t.Run(name, func(t *testing.T) {
			rec := &recordingConverseClient{}

			call(newTestBedrock(rec))

			if rec.input == nil {
				t.Fatal("no request sent")
			}
			if cfg := rec.input.InferenceConfig; cfg != nil && cfg.Temperature != nil {
				t.Errorf("temperature = %v, want none", *cfg.Temperature)
			}
		})
	}
}
