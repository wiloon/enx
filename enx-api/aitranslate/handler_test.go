package aitranslate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"enx-api/ailimit"
	"enx-api/aitranslate/llm/llmtest"
	"enx-api/aitranslate/sentence"
	"enx-api/aitranslate/sentenceword"
	"enx-api/aitranslate/wordcontext"
	"enx-api/billing/credit"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap/zaptest/observer"
)

// tokenTestPricing: cost = ceil((prompt*1 + completion*3) / 3000), floored at 1.
var tokenTestPricing = credit.TokenPricing{WeightIn: 1, WeightOut: 3, Divisor: 3000}

// chatProvider is a provider whose every chat is fake.
func chatProvider(fake *llmtest.Fake) *Provider {
	return &Provider{Chat: fake.Chat, RephraseChat: fake.Chat, ParseAttempts: 1}
}

// fakeTokenLedger stands in for the real billing/credit ledger so these
// tests don't need a database -- mirrors llmtest.Fake's role for the AI
// provider. Same shape as rephrase_handler_test.go's fakeRephraseLedger
// (settleCall is defined there, same package).
type fakeTokenLedger struct {
	balance      int64
	balanceErr   error
	settleErr    error
	settleCalls  []settleCall
	balanceCalls int
	// settleCtxErr is the state of the context the last Settle was given: the
	// real ledger writes nothing on a cancelled one.
	settleCtxErr error
}

func (f *fakeTokenLedger) Balance(ctx context.Context, userID string) (int64, error) {
	f.balanceCalls++
	return f.balance, f.balanceErr
}

func (f *fakeTokenLedger) Settle(ctx context.Context, userID, feature string, cost int64) error {
	f.settleCalls = append(f.settleCalls, settleCall{userID, feature, cost})
	f.settleCtxErr = ctx.Err()
	return f.settleErr
}

// usageCosting2 yields cost = ceil((600 + 900*3)/3000) = ceil(3300/3000) = 2.
var usageCosting2 = Usage{PromptTokens: 600, CompletionTokens: 900}

func doPostTo(t *testing.T, route string, h gin.HandlerFunc, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST(route, h)
	req := httptest.NewRequest(http.MethodPost, route, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func doPost(t *testing.T, h *Handler, body string) *httptest.ResponseRecorder {
	return doPostTo(t, "/api/translate/sentence", h.TranslateSentence, body)
}

func doPostWordInContext(t *testing.T, h *Handler, body string) *httptest.ResponseRecorder {
	return doPostTo(t, "/api/translate/word-in-context", h.TranslateWordInContext, body)
}

// --- TranslateSentence -------------------------------------------------------

func TestHandlerSuccess(t *testing.T) {
	tr := &llmtest.Fake{Reply: "你好世界", Usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(chatProvider(tr), ledger, tokenTestPricing)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool   `json:"success"`
		Chinese string `json:"chinese"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Success || resp.Chinese != "你好世界" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if len(ledger.settleCalls) != 1 || ledger.settleCalls[0].feature != "translate_sentence" || ledger.settleCalls[0].cost != 2 {
		t.Fatalf("unexpected settle calls: %+v", ledger.settleCalls)
	}
}

func TestHandlerTranslatorErrorWithUsageIsBilled(t *testing.T) {
	logs := observeLogs(t)
	tr := &llmtest.Fake{Err: errors.New("unusable reply"), Usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(chatProvider(tr), ledger, tokenTestPricing)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	assertBilledOnFailure(t, w, ledger.settleCalls, logs, "translate_sentence", "unusable reply")
}

// A blank translation is a failed call (#1155): never a 200 with an empty
// chinese, billed only if the model reported usage.
func TestHandlerEmptyTranslationIsAFailedCall(t *testing.T) {
	cases := []struct {
		name    string
		chinese string
		usage   Usage
		assert  func(*testing.T, *httptest.ResponseRecorder, []settleCall, *observer.ObservedLogs, string, string)
	}{
		{"empty with usage", "", usageCosting2, assertBilledOnFailure},
		{"whitespace with usage", "  \n", usageCosting2, assertBilledOnFailure},
		{"empty without usage", "", Usage{}, assertUnbilledFailure},
		{"whitespace without usage", "  \n", Usage{}, assertUnbilledFailure},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logs := observeLogs(t)
			tr := &llmtest.Fake{Reply: tc.chinese, Usage: tc.usage}
			ledger := &fakeTokenLedger{balance: 100}
			w := doPost(t, NewHandler(chatProvider(tr), ledger, tokenTestPricing), `{"sentence":"Hello world"}`)

			tc.assert(t, w, ledger.settleCalls, logs, "translate_sentence", sentence.ErrEmptyTranslation.Error())

			var got map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatalf("response is not JSON: %v: %s", err, w.Body)
			}
			want := map[string]any{"success": false, "code": "ai_upstream_failed", "message": "The AI service is having trouble right now. Please try again."}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("body = %s, want %v", w.Body, want)
			}
		})
	}
}

// Either token count alone is nonzero usage (ADR-094).
func TestHandlerTranslatorErrorWithOneSidedUsageIsBilled(t *testing.T) {
	for name, usage := range map[string]Usage{
		"prompt only":     {PromptTokens: 600},
		"completion only": {CompletionTokens: 900},
	} {
		t.Run(name, func(t *testing.T) {
			ledger := &fakeTokenLedger{balance: 100}
			h := NewHandler(chatProvider(&llmtest.Fake{Err: errors.New("boom"), Usage: usage}), ledger, tokenTestPricing)
			doPost(t, h, `{"sentence":"Hello world"}`)

			if len(ledger.settleCalls) != 1 {
				t.Fatalf("settle calls = %+v, want one", ledger.settleCalls)
			}
		})
	}
}

func TestHandlerTranslatorErrorWithoutUsageIsNotBilled(t *testing.T) {
	logs := observeLogs(t)
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(chatProvider(&llmtest.Fake{Err: errors.New("upstream timeout")}), ledger, tokenTestPricing)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	assertUnbilledFailure(t, w, ledger.settleCalls, logs, "translate_sentence", "upstream timeout")
}

func TestHandlerFailedSettleOnBilledFailureLogsUnsettled(t *testing.T) {
	logs := observeLogs(t)
	tr := &llmtest.Fake{Err: errors.New("unusable reply"), Usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100, settleErr: errors.New("db write failed")}
	h := NewHandler(chatProvider(tr), ledger, tokenTestPricing)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	assertUnsettledOnFailure(t, w, ledger.settleCalls, logs, "translate_sentence", "unusable reply")
}

// A client that went away is not a model error, so it must not raise the ops
// alert (ADR-094).
func TestHandlerCancelledRequestWithoutUsageIsNotAnOpsAlert(t *testing.T) {
	logs := observeLogs(t)
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(chatProvider(&llmtest.Fake{Err: context.Canceled}), ledger, tokenTestPricing)
	w := doPostWithContext(t, cancelledContext(), "/api/translate/sentence", h.TranslateSentence, `{"sentence":"Hello world"}`)

	assertCancelledUnbilled(t, w, ledger.settleCalls, logs, "translate_sentence")
}

func TestHandlerTimedOutRequestWithoutUsageStillAlerts(t *testing.T) {
	logs := observeLogs(t)
	ctx, cancel := context.WithDeadline(context.Background(), time.Unix(0, 0))
	defer cancel()
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(chatProvider(&llmtest.Fake{Err: context.DeadlineExceeded}), ledger, tokenTestPricing)
	w := doPostWithContext(t, ctx, "/api/translate/sentence", h.TranslateSentence, `{"sentence":"Hello world"}`)

	assertUnbilledFailure(t, w, ledger.settleCalls, logs, "translate_sentence", "context deadline exceeded")
}

func TestHandlerCancelledRequestWithUsageIsStillBilled(t *testing.T) {
	logs := observeLogs(t)
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(chatProvider(&llmtest.Fake{Err: context.Canceled, Usage: usageCosting2}), ledger, tokenTestPricing)
	w := doPostWithContext(t, cancelledContext(), "/api/translate/sentence", h.TranslateSentence, `{"sentence":"Hello world"}`)

	assertBilledOnFailure(t, w, ledger.settleCalls, logs, "translate_sentence", "context canceled")
	if ledger.settleCtxErr != nil {
		t.Fatalf("Settle got a dead context: %v", ledger.settleCtxErr)
	}
}

func TestHandlerInsufficientBalanceReturns402(t *testing.T) {
	tr := &llmtest.Fake{Reply: "unused", Usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 0}
	h := NewHandler(chatProvider(tr), ledger, tokenTestPricing)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("status: got %d want 402, body=%s", w.Code, w.Body.String())
	}
	if len(tr.Calls) != 0 || len(ledger.settleCalls) != 0 {
		t.Fatal("a broke user must not reach the provider or be billed")
	}
}

func TestHandlerNotConfigured(t *testing.T) {
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(nil, ledger, tokenTestPricing)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
	if ledger.balanceCalls != 0 || len(ledger.settleCalls) != 0 {
		t.Fatalf("an unconfigured translator fails before the ledger is touched")
	}
}

func TestHandlerUnpricedConfig(t *testing.T) {
	tr := &llmtest.Fake{Reply: "unused", Usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(chatProvider(tr), ledger, credit.TokenPricing{WeightIn: 0, WeightOut: 0, Divisor: 0})
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
	if len(tr.Calls) != 0 || len(ledger.settleCalls) != 0 {
		t.Fatal("an unpriced feature must not call the provider or bill")
	}
}

func TestHandlerSettleErrorStillReturnsResult(t *testing.T) {
	tr := &llmtest.Fake{Reply: "你好世界", Usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100, settleErr: errors.New("db write failed")}
	h := NewHandler(chatProvider(tr), ledger, tokenTestPricing)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	if len(ledger.settleCalls) != 1 {
		t.Fatalf("Settle should have been attempted once, got %d", len(ledger.settleCalls))
	}
}

func TestHandlerMissingSentence(t *testing.T) {
	h := NewHandler(chatProvider(&llmtest.Fake{Reply: "unused"}), &fakeTokenLedger{balance: 100}, tokenTestPricing)
	w := doPost(t, h, `{}`)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400, body=%s", w.Code, w.Body.String())
	}
}

// --- TranslateWordInContext ------------------------------------------------

func TestWordInContextHandlerSuccess(t *testing.T) {
	tr := &llmtest.Fake{Reply: `{"word":"银行"}`, Usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(chatProvider(tr), ledger, tokenTestPricing)
	w := doPostWordInContext(t, h, `{"sentence":"I deposited cash at the bank.","word":"bank","dictionaryChinese":"n. 银行；水岸"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool   `json:"success"`
		Chinese string `json:"chinese"`
		Why     string `json:"why"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Success || resp.Chinese != "银行" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if want := wordcontext.BuildUserContent("I deposited cash at the bank.", "bank", "n. 银行；水岸"); tr.Calls[0].User != want {
		t.Fatalf("provider got %q, want %q", tr.Calls[0].User, want)
	}
	if len(ledger.settleCalls) != 1 || ledger.settleCalls[0].feature != "translate_word_in_context" || ledger.settleCalls[0].cost != 2 {
		t.Fatalf("unexpected settle calls: %+v", ledger.settleCalls)
	}
}

// The client omits dictionaryChinese when the dictionary lookup it ran
// before this call failed or the word has no entry -- still a valid
// request, and "why" naturally comes back empty (nothing to compare
// against).
func TestWordInContextHandlerNoDictionaryDefinition(t *testing.T) {
	tr := &llmtest.Fake{Reply: `{"word":"找到并联系"}`, Usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(chatProvider(tr), ledger, tokenTestPricing)
	w := doPostWordInContext(t, h, `{"sentence":"Hunt down emails and reach out.","word":"hunt down emails"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	if want := wordcontext.BuildUserContent("Hunt down emails and reach out.", "hunt down emails", ""); tr.Calls[0].User != want {
		t.Fatalf("provider got %q, want %q", tr.Calls[0].User, want)
	}
}

func TestWordInContextHandlerTranslatorErrorWithUsageIsBilled(t *testing.T) {
	logs := observeLogs(t)
	tr := &llmtest.Fake{Err: errors.New("unusable reply"), Usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(chatProvider(tr), ledger, tokenTestPricing)
	w := doPostWordInContext(t, h, `{"sentence":"I deposited cash at the bank.","word":"bank"}`)

	assertBilledOnFailure(t, w, ledger.settleCalls, logs, "translate_word_in_context", "unusable reply")
}

// #1136: a reply whose only "word" sits in a nested object is not the
// model's gloss for this word, so it is a 502, not a 200 with that gloss.
func TestWordInContextHandlerNestedWordReplyIsBadGateway(t *testing.T) {
	tr := &llmtest.Fake{Reply: `{"metadata":{"word":"银行"}}`, Usage: usageCosting2}
	h := NewHandler(chatProvider(tr), &fakeTokenLedger{balance: 100}, tokenTestPricing)
	w := doPostWordInContext(t, h, `{"sentence":"I deposited cash at the bank.","word":"bank"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "银行") {
		t.Fatalf("nested gloss leaked into the response: %s", w.Body.String())
	}
}

func TestWordInContextHandlerNotConfigured(t *testing.T) {
	h := NewHandler(nil, &fakeTokenLedger{balance: 100}, tokenTestPricing)
	w := doPostWordInContext(t, h, `{"sentence":"I deposited cash at the bank.","word":"bank"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
}

func TestWordInContextHandlerMissingFields(t *testing.T) {
	h := NewHandler(chatProvider(&llmtest.Fake{Reply: "unused"}), &fakeTokenLedger{balance: 100}, tokenTestPricing)
	w := doPostWordInContext(t, h, `{"sentence":"I deposited cash at the bank."}`)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400, body=%s", w.Code, w.Body.String())
	}
}

// --- TranslateSentenceWithWords (ADR-023 Decision 9) ----------------------

func doPostSentenceWithWords(t *testing.T, h *Handler, body string) *httptest.ResponseRecorder {
	return doPostTo(t, "/api/translate/sentence-with-words", h.TranslateSentenceWithWords, body)
}

func TestSentenceWithWordsHandlerInsufficientBalance(t *testing.T) {
	tr := &llmtest.Fake{Reply: `{"sentence":"x","words":[]}`, Usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 0}
	h := NewHandler(chatProvider(tr), ledger, tokenTestPricing)
	w := doPostSentenceWithWords(t, h, `{"sentence":"I deposited cash at the bank.","words":[{"word":"bank"}]}`)

	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("status: got %d want 402, body=%s", w.Code, w.Body.String())
	}
	if len(tr.Calls) != 0 {
		t.Fatal("a broke user must not reach the provider")
	}
}

func TestSentenceWithWordsHandlerNotConfigured(t *testing.T) {
	h := NewHandler(nil, &fakeTokenLedger{balance: 100}, tokenTestPricing)
	w := doPostSentenceWithWords(t, h, `{"sentence":"I deposited cash at the bank.","words":[{"word":"bank"}]}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
}

func TestSentenceWithWordsHandlerSuccess(t *testing.T) {
	tr := &llmtest.Fake{
		Reply: `{"sentence":"我在银行存了现金。","words":[{"word":"bank","chinese":"银行","why":""},{"word":"cash","chinese":"","why":""}]}`,
		Usage: usageCosting2,
	}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(chatProvider(tr), ledger, tokenTestPricing)
	w := doPostSentenceWithWords(t, h, `{"sentence":"I deposited cash at the bank.","words":[`+
		`{"word":"bank","dictionaryChinese":"银行"},{"word":" Bank ","dictionaryChinese":"x"},`+
		`{"word":"","dictionaryChinese":"y"},{"word":"cash"}]}`+" \n\t")

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool   `json:"success"`
		Chinese string `json:"chinese"`
		Words   []struct {
			Word    string `json:"word"`
			Chinese string `json:"chinese"`
			Why     string `json:"why"`
		} `json:"words"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Success || resp.Chinese != "我在银行存了现金。" || len(resp.Words) != 2 ||
		resp.Words[0].Word != "bank" || resp.Words[0].Chinese != "银行" || resp.Words[1].Word != "cash" || resp.Words[1].Chinese != "" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	// The provider sees the deduplicated words, first occurrence kept.
	if len(tr.Calls) != 1 {
		t.Fatalf("expected one provider call, got %d", len(tr.Calls))
	}
	want := sentenceword.BuildWordsUserContent("I deposited cash at the bank.",
		[]sentenceword.WordInput{{Word: "bank", DictionaryDefinition: "银行"}, {Word: "cash"}})
	if tr.Calls[0].User != want {
		t.Fatalf("provider input: %q, want %q", tr.Calls[0].User, want)
	}
	if len(ledger.settleCalls) != 1 || ledger.settleCalls[0].feature != "translate_sentence_with_word" || ledger.settleCalls[0].cost != 2 {
		t.Fatalf("unexpected settle calls: %+v", ledger.settleCalls)
	}
}

func TestSentenceWithWordsHandlerInvalidInputIs400BeforeProvider(t *testing.T) {
	for _, body := range []string{
		`{"words":[{"word":"bank"}]}`,
		`{"sentence":"   ","words":[{"word":"bank"}]}`,
		`{"sentence":"I bank."}`,
		`{"sentence":"I bank.","words":[]}`,
		`{"sentence":"I bank.","words":[{"word":"  ","dictionaryChinese":"银行"}]}`,
		`not json`,
		`{"sentence":"I bank.","words":[{"word":"bank"}]} {}`,
		`{"sentence":"I bank.","words":[{"word":"bank"}]} trailing`,
	} {
		tr := &llmtest.Fake{}
		ledger := &fakeTokenLedger{balance: 100}
		h := NewHandler(chatProvider(tr), ledger, tokenTestPricing)
		w := doPostSentenceWithWords(t, h, body)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: status got %d want 400", body, w.Code)
		}
		if len(tr.Calls) != 0 || ledger.balanceCalls != 0 || len(ledger.settleCalls) != 0 {
			t.Errorf("%s: provider calls=%d, balance calls=%d, settlements=%d",
				body, len(tr.Calls), ledger.balanceCalls, len(ledger.settleCalls))
		}
	}
}

func TestSentenceWithWordsHandlerMissingSentenceIs502Billed(t *testing.T) {
	logs := observeLogs(t)
	tr := &llmtest.Fake{Err: errors.New("sentenceword: reply has no sentence translation"), Usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(chatProvider(tr), ledger, tokenTestPricing)
	w := doPostSentenceWithWords(t, h, `{"sentence":"I bank.","words":[{"word":"bank"}]}`)

	assertBilledOnFailure(t, w, ledger.settleCalls, logs, "translate_sentence_with_word", "sentenceword: reply has no sentence translation")
}

type fakeGate struct {
	verdict ailimit.Verdict
	checks  int
}

func (g *fakeGate) Check(context.Context, string) ailimit.Verdict {
	g.checks++
	return g.verdict
}

// A trial-only user over the trial's call rate (ADR-048 Decision 7) gets a
// 429 before the provider is called, and is not billed. Its code tells the
// clients it apart from the other 429s (ADR-060 Decision 4).
func TestHandlerTrialLimitReturns429(t *testing.T) {
	for _, tc := range []struct {
		verdict ailimit.Verdict
		code    string
		message string
	}{
		{ailimit.LimitedPerDay, "trial_limit_day", "You've reached today's trial limit. Try again in "},
		{ailimit.LimitedPerMinute, "trial_limit_minute", "Too many requests. Please wait a minute and try again."},
	} {
		t.Run(tc.verdict.String(), func(t *testing.T) {
			tr := &llmtest.Fake{Reply: "unused", Usage: usageCosting2}
			ledger := &fakeTokenLedger{balance: 100}
			h := NewHandler(chatProvider(tr), ledger, tokenTestPricing).WithTrialGate(&fakeGate{verdict: tc.verdict})
			w := doPost(t, h, `{"sentence":"Hello world"}`)

			if w.Code != http.StatusTooManyRequests {
				t.Fatalf("status: got %d want 429, body=%s", w.Code, w.Body.String())
			}
			var body map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &body)
			if msg, _ := body["message"].(string); !strings.HasPrefix(msg, tc.message) {
				t.Fatalf("message = %q, want it to start with %q", msg, tc.message)
			}
			if body["code"] != tc.code {
				t.Fatalf("code = %v, want %q", body["code"], tc.code)
			}
			if len(tr.Calls) != 0 || len(ledger.settleCalls) != 0 {
				t.Fatal("a limited call must not reach the provider or be billed")
			}
		})
	}
}

// The balance pre-check runs first: a broke trial user is told to pay, and
// the refused call doesn't use up a trial slot.
func TestHandlerBrokeUserGets402WithoutUsingTrialSlot(t *testing.T) {
	gate := &fakeGate{verdict: ailimit.Allowed}
	h := NewHandler(chatProvider(&llmtest.Fake{Reply: "unused"}), &fakeTokenLedger{balance: 0}, tokenTestPricing).WithTrialGate(gate)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusPaymentRequired || gate.checks != 0 {
		t.Fatalf("status=%d gate checks=%d, want 402 and 0", w.Code, gate.checks)
	}
}
