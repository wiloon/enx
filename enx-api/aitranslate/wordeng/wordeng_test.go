package wordeng

import (
	"errors"
	"strings"
	"testing"
)

func TestParseResultAcceptsAWellFormedReply(t *testing.T) {
	raw := `{"is_word": true, "quality": 9, "senses": [
		{"pos": "noun", "gloss": "A stylish person.", "example": "He is a real rizzler."},
		{"pos": "adj", "gloss": "Stylish or charming.", "example": "That look is rizzler."}
	]}`
	got, err := ParseResult(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !got.IsWord || got.Quality != 9 || len(got.Senses) != 2 {
		t.Fatalf("got %+v", got)
	}
	if got.Senses[0] != (Sense{POS: "noun", Gloss: "A stylish person.", Example: "He is a real rizzler."}) {
		t.Fatalf("sense 0 = %+v", got.Senses[0])
	}
	if got.Senses[1].POS != "adj" {
		t.Fatalf("sense 1 pos = %q", got.Senses[1].POS)
	}
}

func TestParseResultToleratesAFenceAndStrayProse(t *testing.T) {
	raw := "Sure!\n```json\n{\"is_word\": true, \"quality\": 8, \"senses\": [{\"pos\": \"verb\", \"gloss\": \"To charm.\", \"example\": \"She can rizzler anyone.\"}]}\n```"
	got, err := ParseResult(raw)
	if err != nil || !got.IsWord || got.Senses[0].Gloss != "To charm." {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestParseResultNotAWordIsNotAnError(t *testing.T) {
	for _, raw := range []string{
		`{"is_word": false, "quality": 0, "senses": []}`,
		`{"is_word": false}`,
		`{"is_word": false, "quality": 9, "senses": [{"pos": "noun", "gloss": "Thing.", "example": "A thing."}]}`,
	} {
		got, err := ParseResult(raw)
		if err != nil || got.IsWord || got.Quality != 0 || len(got.Senses) != 0 {
			t.Errorf("ParseResult(%s) = %+v, %v; want an empty not-a-word result", raw, got, err)
		}
	}
}

func TestParseResultRoundsAFractionalQuality(t *testing.T) {
	raw := `{"is_word": true, "quality": 7.6, "senses": [{"pos": "noun", "gloss": "A thing.", "example": "One thing."}]}`
	got, err := ParseResult(raw)
	if err != nil || got.Quality != 8 {
		t.Fatalf("got %+v, %v, want quality 8", got, err)
	}
}

func TestParseResultRejects(t *testing.T) {
	sense := func(pos, gloss, example string) string {
		return `{"is_word": true, "quality": 9, "senses": [{"pos": "` + pos + `", "gloss": "` + gloss + `", "example": "` + example + `"}]}`
	}
	many := strings.Repeat(`{"pos":"noun","gloss":"A thing.","example":"One thing."},`, MaxSenses+1)
	for name, raw := range map[string]string{
		"no JSON at all":          "I think it means something nice",
		"truncated JSON":          `{"is_word": true, "quality": 9, "senses": [`,
		"no is_word":              `{"quality": 9, "senses": [{"pos":"noun","gloss":"A thing.","example":"One."}]}`,
		"no quality":              `{"is_word": true, "senses": [{"pos":"noun","gloss":"A thing.","example":"One."}]}`,
		"quality above the scale": `{"is_word": true, "quality": 11, "senses": [{"pos":"noun","gloss":"A thing.","example":"One."}]}`,
		"negative quality":        `{"is_word": true, "quality": -1, "senses": [{"pos":"noun","gloss":"A thing.","example":"One."}]}`,
		"no senses":               `{"is_word": true, "quality": 9, "senses": []}`,
		"too many senses":         `{"is_word": true, "quality": 9, "senses": [` + strings.TrimSuffix(many, ",") + `]}`,
		"empty gloss":             sense("noun", "", "One thing."),
		"missing example":         `{"is_word": true, "quality": 9, "senses": [{"pos":"noun","gloss":"A thing."}]}`,
		"empty example":           sense("noun", "A thing.", ""),
		"Chinese in gloss":        sense("noun", "很有魅力的人", "He is stylish."),
		"Chinese in example":      sense("noun", "A stylish person.", "他很有魅力。"),
		"gloss with HTML":         sense("noun", "<b>stylish</b>", "He is stylish."),
		"gloss with markdown":     sense("noun", "**stylish**", "He is stylish."),
		"gloss with a link":       sense("noun", "see http://evil.example", "He is stylish."),
		"gloss too long":          sense("noun", strings.Repeat("a", 201), "One thing."),
		"example too long":        sense("noun", "A thing.", strings.Repeat("a", 201)),
		"gloss with a line break": sense("noun", "first\\nsecond", "One thing."),
		"unknown pos":             sense("n.", "A thing.", "One thing."),
		"empty pos":               sense("", "A thing.", "One thing."),
	} {
		got, err := ParseResult(raw)
		if !errors.Is(err, ErrInvalidReply) || got.IsWord {
			t.Errorf("%s: got %+v, %v; want ErrInvalidReply", name, got, err)
		}
	}
}

func TestPromptVersionIsSet(t *testing.T) {
	if PromptVersion == "" {
		t.Fatal("PromptVersion must be set")
	}
}
