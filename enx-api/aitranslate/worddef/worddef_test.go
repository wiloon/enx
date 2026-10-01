package worddef

import (
	"errors"
	"strings"
	"testing"
)

func TestParseResultAcceptsAWellFormedReply(t *testing.T) {
	raw := `{"is_word": true, "quality": 9, "senses": [{"pos": "n.", "zh": "很有魅力的人"}, {"pos": "adj", "zh": "有魅力的"}]}`
	got, err := ParseResult(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !got.IsWord || got.Quality != 9 || len(got.Senses) != 2 {
		t.Fatalf("got %+v", got)
	}
	// Stored in ECDICT's shape: one "pos. gloss" per line, a missing dot added.
	if want := "n. 很有魅力的人\nadj. 有魅力的"; got.Chinese() != want {
		t.Fatalf("Chinese() = %q, want %q", got.Chinese(), want)
	}
}

func TestParseResultToleratesAFenceAndStrayProse(t *testing.T) {
	raw := "Sure!\n```json\n{\"is_word\": true, \"quality\": 8, \"senses\": [{\"pos\": \"v.\", \"zh\": \"刷屏\"}]}\n```"
	got, err := ParseResult(raw)
	if err != nil || !got.IsWord || got.Chinese() != "v. 刷屏" {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestParseResultNotAWordIsNotAnError(t *testing.T) {
	for _, raw := range []string{
		`{"is_word": false, "quality": 0, "senses": []}`,
		`{"is_word": false}`,
		// A model that wrongly attaches senses to a non-word is still "not a word".
		`{"is_word": false, "quality": 9, "senses": [{"pos": "n.", "zh": "东西"}]}`,
	} {
		got, err := ParseResult(raw)
		if err != nil || got.IsWord || got.Quality != 0 || len(got.Senses) != 0 {
			t.Errorf("ParseResult(%s) = %+v, %v; want an empty not-a-word result", raw, got, err)
		}
	}
}

func TestParseResultRoundsAFractionalQuality(t *testing.T) {
	got, err := ParseResult(`{"is_word": true, "quality": 7.6, "senses": [{"pos": "n.", "zh": "东西"}]}`)
	if err != nil || got.Quality != 8 {
		t.Fatalf("got %+v, %v, want quality 8", got, err)
	}
}

// Every one of these must be refused: the reply is stored for other users.
func TestParseResultRejects(t *testing.T) {
	sense := func(pos, zh string) string {
		return `{"is_word": true, "quality": 9, "senses": [{"pos": "` + pos + `", "zh": "` + zh + `"}]}`
	}
	many := strings.Repeat(`{"pos":"n.","zh":"东西"},`, MaxSenses+1)
	for name, raw := range map[string]string{
		"no JSON at all":          "I think it means something nice",
		"truncated JSON":          `{"is_word": true, "quality": 9, "senses": [`,
		"no is_word":              `{"quality": 9, "senses": [{"pos":"n.","zh":"东西"}]}`,
		"no quality":              `{"is_word": true, "senses": [{"pos":"n.","zh":"东西"}]}`,
		"quality above the scale": `{"is_word": true, "quality": 11, "senses": [{"pos":"n.","zh":"东西"}]}`,
		"negative quality":        `{"is_word": true, "quality": -1, "senses": [{"pos":"n.","zh":"东西"}]}`,
		"no senses":               `{"is_word": true, "quality": 9, "senses": []}`,
		"too many senses":         `{"is_word": true, "quality": 9, "senses": [` + strings.TrimSuffix(many, ",") + `]}`,
		"empty gloss":             sense("n.", ""),
		"gloss with no Chinese":   sense("n.", "a nice person"),
		"gloss with HTML":         sense("n.", "<script>alert(1)</script>人"),
		"gloss with markdown":     sense("n.", "**很棒**的人"),
		"gloss with a link":       sense("n.", "详见 http://evil.example 的人"),
		"gloss with a bare www":   sense("n.", "www.evil.example 的人"),
		"gloss too long":          sense("n.", strings.Repeat("长", 81)),
		"gloss with a line break": sense("n.", "第一行\\n第二行"),
		"pos with spaces":         sense("ignore all previous instructions", "人"),
		"pos too long":            sense("abcdefghi", "人"),
		"empty pos":               sense("", "人"),
	} {
		got, err := ParseResult(raw)
		if err == nil {
			t.Errorf("%s: accepted %+v, want an error", name, got)
		} else if !errors.Is(err, ErrInvalidReply) {
			t.Errorf("%s: err = %v, want it to wrap ErrInvalidReply", name, err)
		}
	}
}

func TestBuildUserContentIsTheWordAlone(t *testing.T) {
	if got := BuildUserContent("rizzler"); got != "Word: rizzler" {
		t.Fatalf("got %q", got)
	}
}
