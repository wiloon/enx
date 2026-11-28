package server

import (
	"reflect"
	"testing"

	"enx-api/utils/sqlitex"
	"enx-api/wiktionarybuild/wiktionarytest"
)

// ADR-098: with a Wiktionary file configured, an English-explanation user's
// lookup answers from it, never in Chinese, and gives the word an id.
func TestE2E_EnglishExplanationsAnswerFromWiktionary(t *testing.T) {
	cfg := noTrialConfig()
	cfg.Wiktionary.DBPath = wiktionarytest.Create(t,
		`{"word":"hello","lang_code":"en","pos":"intj","sounds":[{"ipa":"/həˈloʊ/","tags":["US"]},{"ipa":"/həˈləʊ/","tags":["UK"]}],"senses":[{"glosses":["A greeting."],"examples":[{"text":"Hello, everyone."}]}]}`,
		`{"word":"leave","lang_code":"en","pos":"verb","sounds":[{"ipa":"/liːv/","tags":["US"]}],"senses":[{"glosses":["To go away from."]}],"forms":[{"form":"left","tags":["past"]}]}`,
	)
	base, _, token := adminDictEnvWithConfig(t, cfg)
	t.Cleanup(func() { sqlitex.DB.Exec("DELETE FROM words WHERE english = ?", "left") })
	setExplanationLanguage(t, base, token, "en")

	results := entriesRaw(t, base, token, `{"words":["hello","Left","zzxqv"]}`)

	hello := results[0]
	wantSenses := []any{map[string]any{"pos": "intj", "gloss": "A greeting.", "example": "Hello, everyone."}}
	if hello["Status"] != "found" || hello["Source"] != "wiktionary" || hello["Origin"] != "wiktionary" ||
		hello["ExplanationLanguage"] != "en" || hello["Chinese"] != "" || hello["Pronunciation"] != "" ||
		hello["PronunciationUS"] != "/həˈloʊ/" || hello["PronunciationUK"] != "/həˈləʊ/" ||
		!reflect.DeepEqual(hello["Senses"], wantSenses) || hello["LemmaNote"] != nil || hello["Id"] == "" {
		t.Errorf("hello = %v", hello)
	}

	left := results[1]
	if left["Status"] != "found" || left["English"] != "Left" || left["LemmaNote"] != "past tense of leave" ||
		left["PronunciationUS"] != nil || left["Chinese"] != "" {
		t.Errorf("Left = %v", left)
	}
	// ECDICT does not know "left" here: the row has no Chinese.
	var row struct{ ID, English, Chinese, Pronunciation, Source string }
	if err := sqlitex.DB.Raw("SELECT id, english, COALESCE(chinese, '') AS chinese, COALESCE(pronunciation, '') AS pronunciation, source FROM words WHERE english = ?", "left").Scan(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.ID == "" || left["Id"] != row.ID || row.English != "left" || row.Chinese != "" || row.Pronunciation != "" || row.Source != "wiktionary" {
		t.Errorf("words row = %+v, answered id %v", row, left["Id"])
	}

	// ADR-098 Decision 5 / #1236: an en miss offers the AI fallback.
	if miss := results[2]; miss["Status"] != "not_found" || miss["ExplanationLanguage"] != "en" || miss["AIFallback"] == nil || miss["Chinese"] != nil {
		t.Errorf("miss = %v, want not_found with an AI offer", miss)
	}
}
