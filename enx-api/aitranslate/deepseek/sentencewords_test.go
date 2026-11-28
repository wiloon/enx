package deepseek

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/aitranslate/sentenceword"
)

func TestTranslateSentenceWithWordsOneRequestCarriesEveryDictionaryMeaning(t *testing.T) {
	requests := 0
	var capturedBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		capturedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"{\"sentence\":\"我在银行存了现金。\",\"words\":[{\"word\":\"bank\",\"chinese\":\"银行\",\"why\":\"\"},{\"word\":\"cash\",\"chinese\":\"现金\",\"why\":\"\"}]}"}}],"usage":{"prompt_tokens":120,"completion_tokens":60,"total_tokens":180}}`))
	}))
	defer srv.Close()

	d := newTestDeepSeek(srv.URL)
	res, u, err := sentenceword.CallWords(context.Background(), d.Chat, "I deposited cash at the bank.", []sentenceword.WordInput{
		{Word: "bank", DictionaryDefinition: "银行DICT"},
		{Word: "cash", DictionaryDefinition: "现金DICT"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if requests != 1 {
		t.Fatalf("expected one provider request, got %d", requests)
	}
	if len(res.Words) != 2 || res.Words[1].Chinese != "现金" || u.PromptTokens != 120 {
		t.Fatalf("result: %+v usage: %+v", res, u)
	}
	for _, want := range []string{"银行DICT", "现金DICT", "deposited cash"} {
		// The JSON body escapes nothing in CJK text, so a plain substring check holds.
		if !bytes.Contains(capturedBody, []byte(want)) {
			t.Fatalf("request body missing %q: %s", want, capturedBody)
		}
	}
}
