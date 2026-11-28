package aitranslate

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"enx-api/ailimit"
	"enx-api/aitranslate/llm/llmtest"
	"enx-api/aitranslate/sentence"
	"enx-api/aitranslate/sentenceword"
	"enx-api/aitranslate/wordcontext"
	"enx-api/aitranslate/zh"
	"enx-api/dictionary"
)

// The three in-context AI calls follow the user's explanation language
// (ADR-098 Decision 7).

type fakeLanguages struct {
	lang dictionary.Language
	err  error
}

func (f fakeLanguages) ExplanationLanguage(context.Context, string) (dictionary.Language, error) {
	return f.lang, f.err
}

// languageCall is one request to one of the three endpoints, served with the
// given explanation language and model reply.
type languageResult struct {
	status int
	body   string
	chat   *llmtest.Fake
	ledger *fakeTokenLedger
}

const (
	sentencePath = "sentence"
	inContext    = "word-in-context"
	withWords    = "sentence-with-words"
)

func callIn(t *testing.T, lang dictionary.Language, endpoint, request, reply string) languageResult {
	t.Helper()
	chat := &llmtest.Fake{Reply: reply, Usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	provider := chatProvider(chat)
	provider.ParseAttempts = 3
	h := NewHandler(provider, ledger, tokenTestPricing).WithExplanationLanguages(fakeLanguages{lang: lang})
	var code int
	var body string
	switch endpoint {
	case sentencePath:
		w := doPost(t, h, request)
		code, body = w.Code, w.Body.String()
	case inContext:
		w := doPostWordInContext(t, h, request)
		code, body = w.Code, w.Body.String()
	case withWords:
		w := doPostSentenceWithWords(t, h, request)
		code, body = w.Code, w.Body.String()
	default:
		t.Fatalf("unknown endpoint %q", endpoint)
	}
	return languageResult{code, body, chat, ledger}
}

var languageEndpoints = []struct {
	endpoint, request, reply string
	zhPrompt, enPrompt       string
}{
	{sentencePath, `{"sentence":"The bank was steep."}`, "The side of the river went up fast.",
		sentence.SystemPrompt, sentence.EnglishSystemPrompt},
	{inContext, `{"sentence":"The bank was steep.","word":"bank"}`, `{"word":"the side of a river","why":""}`,
		wordcontext.SystemPrompt, wordcontext.EnglishSystemPrompt},
	{withWords, `{"sentence":"The bank was steep.","words":[{"word":"bank"}]}`,
		`{"sentence":"The side of the river went up fast.","words":[{"word":"bank","chinese":"the side of a river","why":""}]}`,
		sentenceword.WordsSystemPrompt, sentenceword.EnglishWordsSystemPrompt},
}

func TestEachCallSendsThePromptOfTheExplanationLanguage(t *testing.T) {
	for _, e := range languageEndpoints {
		for lang, want := range map[dictionary.Language]string{
			dictionary.LanguageEnglish: e.enPrompt,
			dictionary.LanguageZhHans:  e.zhPrompt,
		} {
			t.Run(e.endpoint+"/"+string(lang), func(t *testing.T) {
				got := callIn(t, lang, e.endpoint, e.request, e.reply)

				if got.status != http.StatusOK {
					t.Fatalf("status = %d, body = %s", got.status, got.body)
				}
				if len(got.chat.Calls) != 1 || got.chat.Calls[0].System != want {
					t.Errorf("chat calls = %+v, want one with system prompt %q", got.chat.Calls, want)
				}
			})
		}
	}
}

func TestWithoutExplanationLanguagesTheCallsAreChinese(t *testing.T) {
	chat := &llmtest.Fake{Reply: "河岸很陡。", Usage: usageCosting2}
	h := NewHandler(chatProvider(chat), &fakeTokenLedger{balance: 100}, tokenTestPricing)

	w := doPost(t, h, `{"sentence":"The bank was steep."}`)

	if w.Code != http.StatusOK || len(chat.Calls) != 1 || chat.Calls[0].System != sentence.SystemPrompt {
		t.Errorf("status = %d, calls = %+v", w.Code, chat.Calls)
	}
}

func TestAFailedExplanationLanguageReadIsAnInternalError(t *testing.T) {
	for _, e := range languageEndpoints {
		t.Run(e.endpoint, func(t *testing.T) {
			chat := &llmtest.Fake{Reply: e.reply, Usage: usageCosting2}
			ledger := &fakeTokenLedger{balance: 100}
			gate := &fakeGate{verdict: ailimit.Allowed}
			h := NewHandler(chatProvider(chat), ledger, tokenTestPricing).
				WithTrialGate(gate).
				WithExplanationLanguages(fakeLanguages{err: errors.New("db down")})
			handle := map[string]func() (int, string){
				sentencePath: func() (int, string) { w := doPost(t, h, e.request); return w.Code, w.Body.String() },
				inContext:    func() (int, string) { w := doPostWordInContext(t, h, e.request); return w.Code, w.Body.String() },
				withWords:    func() (int, string) { w := doPostSentenceWithWords(t, h, e.request); return w.Code, w.Body.String() },
			}[e.endpoint]

			status, body := handle()

			if status != http.StatusBadGateway {
				t.Fatalf("status = %d, body = %s", status, body)
			}
			assertJSON(t, []byte(body), `{"success":false,"code":"internal_error","message":"Something went wrong on our side. Please try again later."}`)
			if len(chat.Calls) != 0 || len(ledger.settleCalls) != 0 || gate.checks != 0 {
				t.Errorf("chat calls = %d, settled = %+v, gate checks = %d; want none", len(chat.Calls), ledger.settleCalls, gate.checks)
			}
		})
	}
}

func TestEnglishPromptsAskForB1AndNoChineseScriptRule(t *testing.T) {
	for _, e := range languageEndpoints {
		t.Run(e.endpoint, func(t *testing.T) {
			if !strings.Contains(e.enPrompt, "CEFR B1") {
				t.Errorf("prompt does not state CEFR B1: %q", e.enPrompt)
			}
			if strings.Contains(e.enPrompt, zh.SimplifiedRule) {
				t.Error("prompt carries the Simplified Chinese rule")
			}
		})
	}
}

func TestEnglishSentenceCardRestatesWithoutWordNotes(t *testing.T) {
	got := callIn(t, dictionary.LanguageEnglish, sentencePath, `{"sentence":"The bank was steep."}`, "The side of the river went up fast.")

	assertJSON(t, []byte(got.body), `{"success":true,"chinese":"The side of the river went up fast."}`)
	system := got.chat.Calls[0].System
	for _, want := range []string{"one restatement", "simpler English", "no notes on words"} {
		if !strings.Contains(system, want) {
			t.Errorf("system prompt misses %q: %q", want, system)
		}
	}
}

// A reply with Chinese the request does not hold is billed and refused, and an
// in-context one is not asked for again.
func TestChineseInAnEnglishReplyIsABilled502(t *testing.T) {
	for _, tc := range []struct {
		name, endpoint, request, reply string
	}{
		{"sentence card", sentencePath, `{"sentence":"The bank was steep."}`, "河岸很陡。"},
		{"in-context word", inContext, `{"sentence":"The bank was steep.","word":"bank"}`, `{"word":"河岸","why":""}`},
		{"in-context why", inContext, `{"sentence":"The bank was steep.","word":"bank"}`, `{"word":"river side","why":"这里指河岸"}`},
		{"in-context Chinese only in the definition", inContext,
			`{"sentence":"The bank was steep.","word":"bank","dictionaryDefinition":"n. 水岸"}`, `{"word":"水岸","why":""}`},
		{"sentence with words, the sentence", withWords, `{"sentence":"The bank was steep.","words":[{"word":"bank"}]}`,
			`{"sentence":"河岸很陡。","words":[{"word":"bank","chinese":"river side","why":""}]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := callIn(t, dictionary.LanguageEnglish, tc.endpoint, tc.request, tc.reply)

			if got.status != http.StatusBadGateway {
				t.Fatalf("status = %d, body = %s", got.status, got.body)
			}
			assertJSON(t, []byte(got.body), upstreamFailedBody)
			if len(got.chat.Calls) != 1 {
				t.Errorf("chat calls = %d, want 1", len(got.chat.Calls))
			}
			if len(got.ledger.settleCalls) != 1 || got.ledger.settleCalls[0].cost != 2 {
				t.Errorf("settled = %+v, want the one call", got.ledger.settleCalls)
			}
		})
	}
}

func TestChineseInOneWordBlanksOnlyThatWord(t *testing.T) {
	got := callIn(t, dictionary.LanguageEnglish, withWords,
		`{"sentence":"The bank was steep.","words":[
			{"word":"bank","dictionaryDefinition":"n. side of a river"},
			{"word":"steep","dictionaryDefinition":"adj. going up fast"},
			{"word":"was","dictionaryDefinition":"v. be"}]}`,
		`{"sentence":"The side of the river went up fast.","words":[
			{"word":"bank","chinese":"河岸","why":"a river side"},
			{"word":"steep","chinese":"going up fast","why":"指很陡"},
			{"word":"was","chinese":"used to be","why":"past of be"}]}`)

	if got.status != http.StatusOK {
		t.Fatalf("status = %d, body = %s", got.status, got.body)
	}
	assertJSON(t, []byte(got.body), `{"success":true,"chinese":"The side of the river went up fast.","words":[
		{"word":"bank","chinese":"","why":""},
		{"word":"steep","chinese":"","why":""},
		{"word":"was","chinese":"used to be","why":"past of be"}]}`)
	if len(got.ledger.settleCalls) != 1 {
		t.Errorf("settled = %+v, want the one call", got.ledger.settleCalls)
	}
}

// Han characters echoed from the sentence or the words are the page's, not a
// Chinese answer.
func TestChineseEchoedFromTheRequestIsAccepted(t *testing.T) {
	for _, tc := range []struct {
		endpoint, request, reply, response string
	}{
		{sentencePath, `{"sentence":"The sign said 北京."}`, "The sign had the words 北京 on it.",
			`{"success":true,"chinese":"The sign had the words 北京 on it."}`},
		{inContext, `{"sentence":"The sign said so.","word":"北京"}`, `{"word":"北京 is a city","why":"the sign names 北京"}`,
			`{"success":true,"chinese":"北京 is a city","why":"the sign names 北京"}`},
		{withWords, `{"sentence":"The sign said 北京.","words":[{"word":"sign","dictionaryDefinition":"n. board"}]}`,
			`{"sentence":"A board showed 北京.","words":[{"word":"sign","chinese":"a board showing 北京","why":"it shows 北京"}]}`,
			`{"success":true,"chinese":"A board showed 北京.","words":[{"word":"sign","chinese":"a board showing 北京","why":"it shows 北京"}]}`},
	} {
		t.Run(tc.endpoint, func(t *testing.T) {
			got := callIn(t, dictionary.LanguageEnglish, tc.endpoint, tc.request, tc.reply)

			if got.status != http.StatusOK {
				t.Fatalf("status = %d, body = %s", got.status, got.body)
			}
			assertJSON(t, []byte(got.body), tc.response)
		})
	}
}

func TestDictionaryDefinitionReachesThePromptAndWinsOverDictionaryChinese(t *testing.T) {
	for _, tc := range []struct {
		name, fields, want string
	}{
		{"definition only", `"dictionaryDefinition":"n. side of a river"`, "Dictionary definition: n. side of a river"},
		{"definition over Chinese", `"dictionaryDefinition":"n. side of a river","dictionaryChinese":"n. 水岸"`, "Dictionary definition: n. side of a river"},
		{"an older extension", `"dictionaryChinese":"n. 水岸"`, "Dictionary definition: n. 水岸"},
	} {
		for endpoint, request := range map[string]string{
			inContext: `{"sentence":"The bank was steep.","word":"bank",` + tc.fields + `}`,
			withWords: `{"sentence":"The bank was steep.","words":[{"word":"bank",` + tc.fields + `}]}`,
		} {
			t.Run(endpoint+"/"+tc.name, func(t *testing.T) {
				reply := `{"word":"river side","why":"","sentence":"s","words":[]}`

				got := callIn(t, dictionary.LanguageZhHans, endpoint, request, reply)

				if len(got.chat.Calls) != 1 || !strings.HasSuffix(got.chat.Calls[0].User, tc.want) {
					t.Errorf("chat calls = %+v, want a user prompt ending %q", got.chat.Calls, tc.want)
				}
			})
		}
	}
}

func TestSentenceWithWordsWhyFollowsTheEffectiveDefinition(t *testing.T) {
	got := callIn(t, dictionary.LanguageEnglish, withWords,
		`{"sentence":"The bank was steep.","words":[
			{"word":"bank","dictionaryDefinition":"n. money house"},
			{"word":"steep"}]}`,
		`{"sentence":"The side of the river went up fast.","words":[
			{"word":"bank","chinese":"the side of a river","why":"here it is about a river"},
			{"word":"steep","chinese":"going up fast","why":"指很陡"}]}`)

	assertJSON(t, []byte(got.body), `{"success":true,"chinese":"The side of the river went up fast.","words":[
		{"word":"bank","chinese":"the side of a river","why":"here it is about a river"},
		{"word":"steep","chinese":"going up fast","why":""}]}`)
}

func TestChineseRepliesAreUntouchedInZhHans(t *testing.T) {
	got := callIn(t, dictionary.LanguageZhHans, withWords,
		`{"sentence":"The bank was steep.","words":[{"word":"bank","dictionaryChinese":"n. 水岸"}]}`,
		`{"sentence":"河岸很陡。","words":[{"word":"bank","chinese":"河岸","why":"此处指河边"}]}`)

	assertJSON(t, []byte(got.body), `{"success":true,"chinese":"河岸很陡。","words":[{"word":"bank","chinese":"河岸","why":"此处指河边"}]}`)
}
