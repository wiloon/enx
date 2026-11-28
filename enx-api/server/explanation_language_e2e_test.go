package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"enx-api/utils/sqlitex"
)

func setExplanationLanguage(t *testing.T, base, token, language string) {
	t.Helper()
	if code, body := doJSONBody(t, http.MethodPut, base+"/api/me/preferences", token, map[string]any{"explanationLanguage": language}); code != http.StatusOK {
		t.Fatalf("set explanationLanguage %s: %d %v", language, code, body)
	}
}

// entriesRaw is the batch definitions response with every field kept, so a
// test can tell an omitted field from an empty one.
func entriesRaw(t *testing.T, base, token, body string) []map[string]any {
	t.Helper()
	req, err := http.NewRequest("QUERY", base+"/api/dictionary/entries", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("entries: status %d", resp.StatusCode)
	}
	var results []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
		t.Fatal(err)
	}
	return results
}

// ADR-098: a user whose explanation language is English is never answered in
// Chinese. With no Wiktionary file the lookup fails and writes no words row.
func TestE2E_EnglishExplanationsNeverAnswerInChinese(t *testing.T) {
	base, _, token := adminDictEnv(t)

	before := entriesRaw(t, base, token, `{"words":["hello"]}`)
	if before[0]["ExplanationLanguage"] != "zh-Hans" || before[0]["Status"] != "found" {
		t.Errorf("default language: %v, want found in zh-Hans", before[0])
	}
	wordID, _ := before[0]["Id"].(string)

	setExplanationLanguage(t, base, token, "en")

	for _, result := range entriesRaw(t, base, token, `{"words":["hello","running","zzxqv"]}`) {
		if result["Status"] != "failed" || result["ExplanationLanguage"] != "en" || result["Chinese"] != nil || result["AIFallback"] != nil {
			t.Errorf("en lookup: %v, want failed in en with no Chinese and no AI offer", result)
		}
	}
	var rows int64
	if err := sqlitex.DB.Table("words").Where("english IN ?", []string{"running", "zzxqv"}).Count(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("en lookup wrote %d words rows, want none", rows)
	}

	userID := userIDOf(t, nonAdminSub)
	used := quotaUsed(t, userID)
	for _, path := range []string{"/api/translate?word=hello", "/api/word/hello"} {
		code, body := doJSON(t, http.MethodGet, base+path, token)
		message, _ := body["message"].(string)
		if code != http.StatusServiceUnavailable || !strings.Contains(message, "update Catglish") || body["Chinese"] != nil {
			t.Errorf("GET %s: %d %v, want 503 asking to update Catglish", path, code, body)
		}
	}
	if got := quotaUsed(t, userID); got != used {
		t.Errorf("refused GETs used quota: %d, want %d", got, used)
	}

	// No Wiktionary file: the en AI path refuses before the model (ADR-098).
	code, body := doJSONBody(t, http.MethodPost, base+"/api/dictionary/ai-word", token, map[string]any{"word": "hello"})
	if code != http.StatusServiceUnavailable || body["code"] != "ai_unavailable" {
		t.Errorf("ai-word in en without Wiktionary: %d %v, want ai_unavailable", code, body)
	}

	code, body = doJSONBody(t, http.MethodPost, base+"/api/me/word-lookups", token, map[string]any{"wordId": wordID})
	if code != http.StatusOK || body["explanationLanguage"] != "en" || body["queryCount"] != float64(1) {
		t.Errorf("word-lookups: %d %v, want the count and explanationLanguage en", code, body)
	}
}
