package paragraph

import (
	"context"
	"testing"

	"enx-api/enx"
)

type emptyWordStates struct{}

func (emptyWordStates) FindByEnglish(context.Context, string, []string) ([]enx.WordState, error) {
	return nil, nil
}

func TestParagraphStartingWithDigitIsNotAWord(t *testing.T) {
	out, err := enx.NewTextWords(emptyWordStates{}).In(context.Background(), "their 6-year-old to", "1")
	if err != nil {
		t.Fatal(err)
	}
	word, ok := out["6-year-old"]
	if !ok || word.WordType != 1 {
		t.Fatalf("6-year-old: got %+v, present %v; want word type 1", word, ok)
	}
}

func TestParagraphRemovesEndingPunctuation(t *testing.T) {
	out, err := enx.NewTextWords(emptyWordStates{}).In(context.Background(), "Good morning.", "1")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := out["morning"]; !ok {
		t.Error("missing morning")
	}
}

func TestParagraphRemovesSurroundingPunctuation(t *testing.T) {
	out, err := enx.NewTextWords(emptyWordStates{}).In(context.Background(), "scientists. (Assassins wove through traffic to attach “sticky bombs” to their car doors.) The", "1")
	if err != nil {
		t.Fatal(err)
	}
	for _, word := range []string{"Assassins", "doors"} {
		if _, ok := out[word]; !ok {
			t.Errorf("missing %s", word)
		}
	}
}
