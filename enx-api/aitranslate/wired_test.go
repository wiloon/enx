package aitranslate

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"enx-api/aitranslate/rephrase"
	"enx-api/aitranslate/sentence"
	"enx-api/aitranslate/sentenceword"
	"enx-api/aitranslate/wordcontext"
	"enx-api/aitranslate/worddef"
)

// Tests from the handler through a real provider to an httptest server.

type upstreamReply struct {
	status  int
	content string
}

// upstream answers each request with the next reply (the last one repeats),
// every one billed 600 prompt + 900 completion tokens, and records the bodies.
func upstream(t *testing.T, replies ...upstreamReply) (string, *[]map[string]any) {
	t.Helper()
	bodies := &[]map[string]any{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("decode request body %q: %v", raw, err)
		}
		reply := replies[min(len(*bodies), len(replies)-1)]
		*bodies = append(*bodies, body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(reply.status)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": reply.content}}},
			"usage":   map[string]any{"prompt_tokens": 600, "completion_tokens": 900, "total_tokens": 1500},
		})
	}))
	t.Cleanup(srv.Close)
	return srv.URL, bodies
}

func ok(content string) upstreamReply { return upstreamReply{http.StatusOK, content} }

// wiredFeature is one AI endpoint: what the client posts, what a good model
// reply is, and everything that must follow from it.
type wiredFeature struct {
	name        string
	request     string
	reply       string
	system      string
	user        string
	temperature float64
	response    string
	billing     string
	operation   string
}

var (
	sentenceFeature = wiredFeature{
		name:        "sentence",
		request:     `{"sentence":"I deposited cash at the bank."}`,
		reply:       "我在银行存了现金。",
		system:      sentence.SystemPrompt,
		user:        "I deposited cash at the bank.",
		temperature: sentence.Temperature,
		response:    `{"success":true,"chinese":"我在银行存了现金。"}`,
		billing:     "translate_sentence",
		operation:   "translate_sentence",
	}
	wordFeature = wiredFeature{
		name:        "word in context",
		request:     `{"sentence":"I deposited cash at the bank.","word":"bank","dictionaryChinese":"n. 水岸"}`,
		reply:       `{"word":"银行","why":"此处指金融机构"}`,
		system:      wordcontext.SystemPrompt,
		user:        wordcontext.BuildUserContent("I deposited cash at the bank.", "bank", "n. 水岸"),
		temperature: wordcontext.Temperature,
		response:    `{"success":true,"chinese":"银行","why":"此处指金融机构"}`,
		billing:     "translate_word_in_context",
		operation:   "word_in_context",
	}
	wordsFeature = wiredFeature{
		name:        "sentence with words",
		request:     `{"sentence":"I deposited cash at the bank.","words":[{"word":"bank","dictionaryChinese":"n. 水岸"}]}`,
		reply:       `{"sentence":"我在银行存了现金。","words":[{"word":"bank","chinese":"银行","why":"金融机构"}]}`,
		system:      sentenceword.WordsSystemPrompt,
		user:        sentenceword.BuildWordsUserContent("I deposited cash at the bank.", []sentenceword.WordInput{{Word: "bank", DictionaryChinese: "n. 水岸"}}),
		temperature: sentenceword.Temperature,
		response:    `{"success":true,"chinese":"我在银行存了现金。","words":[{"word":"bank","chinese":"银行","why":"金融机构"}]}`,
		billing:     "translate_sentence_with_word",
		operation:   "sentence_with_words",
	}
	rephraseFeature = wiredFeature{
		name:        "rephrase",
		request:     `{"input":"帮我看下这个"}`,
		reply:       `{"idiomatic":"Could you take a look?","alternatives":[{"text":"Mind looking?","register":"casual"}],"notes":["弱化催促"]}`,
		system:      rephrase.SystemPrompt,
		user:        "帮我看下这个",
		temperature: rephrase.Temperature,
		response:    `{"success":true,"idiomatic":"Could you take a look?","alternatives":[{"text":"Mind looking?","register":"casual"}],"notes":["弱化催促"]}`,
		billing:     "rephrase_to_english",
		operation:   "rephrase",
	}
	wiredFeatures = []wiredFeature{sentenceFeature, wordFeature, wordsFeature, rephraseFeature}
)

const upstreamFailedBody = `{"success":false,"code":"ai_upstream_failed","message":"The AI service is having trouble right now. Please try again."}`

type wiredResult struct {
	response *httptest.ResponseRecorder
	settled  []settleCall
	observed []observed
}

// call posts f's request to the handler wired for provider.
func (f wiredFeature) call(t *testing.T, provider, baseURL, rephraseModel string) wiredResult {
	t.Helper()
	cfg := wiredConfig(provider, baseURL, rephraseModel)
	ledger := &fakeTokenLedger{balance: 100}
	obs := &fakeObserver{}
	var w *httptest.ResponseRecorder
	switch f.name {
	case "sentence":
		w = doPost(t, wiredHandler(t, cfg, ledger, obs), f.request)
	case "word in context":
		w = doPostWordInContext(t, wiredHandler(t, cfg, ledger, obs), f.request)
	case "sentence with words":
		w = doPostSentenceWithWords(t, wiredHandler(t, cfg, ledger, obs), f.request)
	case "rephrase":
		w = doRephrase(t, wiredRephraseHandler(t, cfg, ledger, obs), f.request)
	}
	return wiredResult{w, ledger.settleCalls, obs.calls}
}

func assertJSON(t *testing.T, got []byte, want string) {
	t.Helper()
	var g, w any
	if err := json.Unmarshal(got, &g); err != nil {
		t.Fatalf("response is not JSON: %v: %s", err, got)
	}
	if err := json.Unmarshal([]byte(want), &w); err != nil {
		t.Fatalf("bad expectation %s: %v", want, err)
	}
	if !reflect.DeepEqual(g, w) {
		t.Errorf("response = %s, want %s", got, want)
	}
}

// settled600900 is what 600 prompt + 900 completion tokens cost:
// ceil((600 + 900*3) / 3000) = 2.
func settled600900(billing string) []settleCall { return []settleCall{{feature: billing, cost: 2}} }

func TestWiredFeaturesRequestResponseAndBilling(t *testing.T) {
	providers := []struct {
		name, provider, rephraseModel string
		wantRephraseModel             string
		extra                         map[string]any
	}{
		{"deepseek with a rephrase model", "deepseek", "rephrase-model", "rephrase-model", map[string]any{"thinking": map[string]any{"type": "disabled"}}},
		{"deepseek without one", "deepseek", "", "test-model", map[string]any{"thinking": map[string]any{"type": "disabled"}}},
		{"minimax", "minimax", "", "test-model", nil},
	}
	for _, p := range providers {
		for _, f := range wiredFeatures {
			t.Run(p.name+"/"+f.name, func(t *testing.T) {
				url, bodies := upstream(t, ok(f.reply))

				got := f.call(t, p.provider, url, p.rephraseModel)

				if got.response.Code != http.StatusOK {
					t.Fatalf("status = %d, body = %s", got.response.Code, got.response.Body)
				}
				assertJSON(t, got.response.Body.Bytes(), f.response)

				model := "test-model"
				if f.name == "rephrase" {
					model = p.wantRephraseModel
				}
				want := map[string]any{
					"model": model,
					"messages": []any{
						map[string]any{"role": "system", "content": f.system},
						map[string]any{"role": "user", "content": f.user},
					},
					"temperature": f.temperature,
				}
				for k, v := range p.extra {
					want[k] = v
				}
				if len(*bodies) != 1 || !reflect.DeepEqual((*bodies)[0], want) {
					t.Errorf("requests = %v, want one %v", *bodies, want)
				}
				if !reflect.DeepEqual(got.settled, settled600900(f.billing)) {
					t.Errorf("settled = %+v, want %+v", got.settled, settled600900(f.billing))
				}
				if want := []observed{{p.provider, f.operation, nil, 600, 900}}; !reflect.DeepEqual(got.observed, want) {
					t.Errorf("observed = %+v, want %+v", got.observed, want)
				}
			})
		}
	}
}

func TestWiredFeaturesMapAFailedRequest(t *testing.T) {
	for _, f := range wiredFeatures {
		t.Run(f.name, func(t *testing.T) {
			url, bodies := upstream(t, upstreamReply{http.StatusInternalServerError, "x"})

			got := f.call(t, "deepseek", url, "")

			if got.response.Code != http.StatusBadGateway {
				t.Fatalf("status = %d, body = %s", got.response.Code, got.response.Body)
			}
			assertJSON(t, got.response.Body.Bytes(), upstreamFailedBody)
			if len(*bodies) != 1 || len(got.settled) != 0 {
				t.Errorf("requests = %d, settled = %+v; want one request, nothing billed", len(*bodies), got.settled)
			}
			if len(got.observed) != 1 || got.observed[0].operation != f.operation || got.observed[0].err == nil {
				t.Errorf("observed = %+v, want one failed %s", got.observed, f.operation)
			}
		})
	}
}

// A reply that does not parse is an error response, is billed, and its metric
// outcome is the error.
func TestWiredFeaturesMapAnUnparsableReply(t *testing.T) {
	for _, f := range []wiredFeature{wordFeature, wordsFeature, rephraseFeature} {
		t.Run(f.name, func(t *testing.T) {
			url, bodies := upstream(t, ok("not json at all"))

			got := f.call(t, "deepseek", url, "")

			if got.response.Code != http.StatusBadGateway {
				t.Fatalf("status = %d, body = %s", got.response.Code, got.response.Body)
			}
			assertJSON(t, got.response.Body.Bytes(), upstreamFailedBody)
			if len(*bodies) != 1 {
				t.Errorf("requests = %d, want 1", len(*bodies))
			}
			if !reflect.DeepEqual(got.settled, settled600900(f.billing)) {
				t.Errorf("settled = %+v, want %+v", got.settled, settled600900(f.billing))
			}
			if len(got.observed) != 1 || got.observed[0].provider != "deepseek" || got.observed[0].operation != f.operation ||
				got.observed[0].err == nil || got.observed[0].in != 600 || got.observed[0].out != 900 {
				t.Errorf("observed = %+v, want one failed %s with its tokens", got.observed, f.operation)
			}
		})
	}
}

// A reply that fails sentence.Check is still billed (ADR-094), and the call
// itself is observed as a success.
func TestWiredBlankSentenceIsBilledAndObservedOK(t *testing.T) {
	url, _ := upstream(t, ok("   "))

	got := sentenceFeature.call(t, "deepseek", url, "")

	if got.response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body = %s", got.response.Code, got.response.Body)
	}
	assertJSON(t, got.response.Body.Bytes(), upstreamFailedBody)
	if !reflect.DeepEqual(got.settled, settled600900("translate_sentence")) {
		t.Errorf("settled = %+v", got.settled)
	}
	if want := []observed{{"deepseek", "translate_sentence", nil, 600, 900}}; !reflect.DeepEqual(got.observed, want) {
		t.Errorf("observed = %+v, want %+v", got.observed, want)
	}
}

// MiniMax asks again for an unparsable word-in-context reply: two requests,
// one settle and one observation, both with the tokens of both attempts.
func TestWiredMiniMaxRetriesWordInContextOnce(t *testing.T) {
	url, bodies := upstream(t, ok("not json at all"), ok(wordFeature.reply))

	got := wordFeature.call(t, "minimax", url, "")

	if got.response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", got.response.Code, got.response.Body)
	}
	assertJSON(t, got.response.Body.Bytes(), wordFeature.response)
	if len(*bodies) != 2 || !reflect.DeepEqual((*bodies)[0], (*bodies)[1]) {
		t.Errorf("requests = %v, want the same request twice", *bodies)
	}
	// ceil((1200 + 1800*3) / 3000) = 3.
	if want := []settleCall{{feature: "translate_word_in_context", cost: 3}}; !reflect.DeepEqual(got.settled, want) {
		t.Errorf("settled = %+v, want %+v", got.settled, want)
	}
	if want := []observed{{"minimax", "word_in_context", nil, 1200, 1800}}; !reflect.DeepEqual(got.observed, want) {
		t.Errorf("observed = %+v, want %+v", got.observed, want)
	}
}

func TestWiredMiniMaxDoesNotRetrySentenceWithWords(t *testing.T) {
	url, bodies := upstream(t, ok("not json at all"), ok(wordsFeature.reply))

	got := wordsFeature.call(t, "minimax", url, "")

	if got.response.Code != http.StatusBadGateway || len(*bodies) != 1 {
		t.Errorf("status = %d, requests = %d; want 502 after one", got.response.Code, len(*bodies))
	}
	if !reflect.DeepEqual(got.settled, settled600900("translate_sentence_with_word")) {
		t.Errorf("settled = %+v", got.settled)
	}
}

func TestWiredRephraseUsesTheRephraseModel(t *testing.T) {
	for _, provider := range []string{"deepseek", "openrouter", "gemini", "kimi"} {
		for configured, want := range map[string]string{"rephrase-model": "rephrase-model", "": "test-model"} {
			t.Run(provider+"/"+want, func(t *testing.T) {
				url, bodies := upstream(t, ok(rephraseFeature.reply))

				got := rephraseFeature.call(t, provider, url, configured)

				if got.response.Code != http.StatusOK || len(*bodies) != 1 || (*bodies)[0]["model"] != want {
					t.Errorf("status = %d, requests = %v; want model %s", got.response.Code, *bodies, want)
				}
			})
		}
	}
}

// ADR-045 and ADR-012: which provider serves rephrase and define-word.
func TestWiredProviderCapabilities(t *testing.T) {
	for _, tc := range []struct {
		provider             string
		rephrases, definesIt bool
	}{
		{"deepseek", true, true},
		{"openrouter", true, true},
		{"gemini", true, false},
		{"kimi", true, false},
		{"minimax", true, false},
		{"bedrock", false, false},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			cfg := wiredConfig(tc.provider, "http://127.0.0.1:1", "")

			if _, err := NewRephraser(context.Background(), cfg); (err == nil) != tc.rephrases {
				t.Errorf("NewRephraser error = %v, want rephrase support %v", err, tc.rephrases)
			}
			if _, defines := wiredDefiner(t, cfg, &fakeObserver{}); defines != tc.definesIt {
				t.Errorf("AsWordDefiner = %v, want %v", defines, tc.definesIt)
			}
		})
	}
}

func TestWiredDefineWordIsObserved(t *testing.T) {
	for _, tc := range []struct {
		name, reply string
		fails       bool
	}{
		{"an answer", `{"is_word":true,"quality":9,"senses":[{"pos":"n.","zh":"很有魅力的人"}]}`, false},
		{"an unparsable reply", "not json at all", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			url, bodies := upstream(t, ok(tc.reply))
			obs := &fakeObserver{}
			definer, supported := wiredDefiner(t, wiredConfig("openrouter", url, ""), obs)
			if !supported {
				t.Fatal("openrouter should define words")
			}

			_, u, err := definer.DefineWord(context.Background(), "rizzler")

			if (err != nil) != tc.fails || u.PromptTokens != 600 || u.CompletionTokens != 900 {
				t.Fatalf("usage = %+v, err = %v", u, err)
			}
			if len(*bodies) != 1 || (*bodies)[0]["temperature"] != worddef.Temperature {
				t.Errorf("requests = %v", *bodies)
			}
			if len(obs.calls) != 1 || obs.calls[0].provider != "openrouter" || obs.calls[0].operation != "define_word" ||
				(obs.calls[0].err != nil) != tc.fails || obs.calls[0].in != 600 || obs.calls[0].out != 900 {
				t.Errorf("observed = %+v", obs.calls)
			}
		})
	}
}
