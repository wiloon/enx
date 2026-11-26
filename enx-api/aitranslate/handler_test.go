package aitranslate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"enx-api/ailimit"
	"enx-api/aitranslate/sentenceword"
	"enx-api/aitranslate/wordcontext"
	"enx-api/billing/credit"

	"github.com/gin-gonic/gin"
)

// tokenTestPricing: cost = ceil((prompt*1 + completion*3) / 3000), floored at 1.
var tokenTestPricing = credit.TokenPricing{WeightIn: 1, WeightOut: 3, Divisor: 3000}

type fakeTranslator struct {
	chinese      string
	wordResult   wordcontext.Result
	usage        Usage
	err          error
	sentenceIn   string
	wordIn       string
	dictionaryIn string
	callCount    int
	swwsResult   sentenceword.WordsResult
	wordsIn      []sentenceword.WordInput
}

func (f *fakeTranslator) TranslateSentence(ctx context.Context, sentence string) (string, Usage, error) {
	f.callCount++
	f.sentenceIn = sentence
	return f.chinese, f.usage, f.err
}

func (f *fakeTranslator) TranslateWordInContext(ctx context.Context, sentence, word, dictionaryChinese string) (wordcontext.Result, Usage, error) {
	f.callCount++
	f.sentenceIn, f.wordIn, f.dictionaryIn = sentence, word, dictionaryChinese
	return f.wordResult, f.usage, f.err
}

func (f *fakeTranslator) TranslateSentenceWithWords(ctx context.Context, sentence string, words []sentenceword.WordInput) (sentenceword.WordsResult, Usage, error) {
	f.callCount++
	f.sentenceIn, f.wordsIn = sentence, words
	return f.swwsResult, f.usage, f.err
}

// fakeTokenLedger stands in for the real billing/credit ledger so these
// tests don't need a database -- mirrors fakeTranslator's role for the AI
// provider. Same shape as rephrase_handler_test.go's fakeRephraseLedger
// (settleCall is defined there, same package).
type fakeTokenLedger struct {
	balance      int64
	balanceErr   error
	settleErr    error
	settleCalls  []settleCall
	balanceCalls int
}

func (f *fakeTokenLedger) Balance(ctx context.Context, userID string) (int64, error) {
	f.balanceCalls++
	return f.balance, f.balanceErr
}

func (f *fakeTokenLedger) Settle(ctx context.Context, userID, feature string, cost int64) error {
	f.settleCalls = append(f.settleCalls, settleCall{userID, feature, cost})
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
	tr := &fakeTranslator{chinese: "你好世界", usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(tr, ledger, tokenTestPricing)
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

func TestHandlerTranslatorErrorNotBilled(t *testing.T) {
	tr := &fakeTranslator{err: errors.New("upstream timeout"), usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(tr, ledger, tokenTestPricing)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
	if len(ledger.settleCalls) != 0 {
		t.Fatalf("a failed translation must not be billed, got: %+v", ledger.settleCalls)
	}
}

func TestHandlerInsufficientBalanceReturns402(t *testing.T) {
	tr := &fakeTranslator{chinese: "unused", usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 0}
	h := NewHandler(tr, ledger, tokenTestPricing)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("status: got %d want 402, body=%s", w.Code, w.Body.String())
	}
	if tr.callCount != 0 || len(ledger.settleCalls) != 0 {
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
	tr := &fakeTranslator{chinese: "unused", usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(tr, ledger, credit.TokenPricing{WeightIn: 0, WeightOut: 0, Divisor: 0})
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
	if tr.callCount != 0 || len(ledger.settleCalls) != 0 {
		t.Fatal("an unpriced feature must not call the provider or bill")
	}
}

func TestHandlerSettleErrorStillReturnsResult(t *testing.T) {
	tr := &fakeTranslator{chinese: "你好世界", usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100, settleErr: errors.New("db write failed")}
	h := NewHandler(tr, ledger, tokenTestPricing)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	if len(ledger.settleCalls) != 1 {
		t.Fatalf("Settle should have been attempted once, got %d", len(ledger.settleCalls))
	}
}

func TestHandlerMissingSentence(t *testing.T) {
	h := NewHandler(&fakeTranslator{chinese: "unused"}, &fakeTokenLedger{balance: 100}, tokenTestPricing)
	w := doPost(t, h, `{}`)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400, body=%s", w.Code, w.Body.String())
	}
}

// --- TranslateWordInContext ------------------------------------------------

func TestWordInContextHandlerSuccess(t *testing.T) {
	tr := &fakeTranslator{wordResult: wordcontext.Result{WordChinese: "银行"}, usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(tr, ledger, tokenTestPricing)
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
	if tr.wordIn != "bank" || tr.dictionaryIn != "n. 银行；水岸" {
		t.Fatalf("provider got word %q dictionary %q", tr.wordIn, tr.dictionaryIn)
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
	tr := &fakeTranslator{wordResult: wordcontext.Result{WordChinese: "找到并联系"}, usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(tr, ledger, tokenTestPricing)
	w := doPostWordInContext(t, h, `{"sentence":"Hunt down emails and reach out.","word":"hunt down emails"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	if tr.dictionaryIn != "" {
		t.Fatalf("expected empty dictionaryIn, got %q", tr.dictionaryIn)
	}
}

func TestWordInContextHandlerTranslatorErrorNotBilled(t *testing.T) {
	tr := &fakeTranslator{err: errors.New("upstream timeout"), usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(tr, ledger, tokenTestPricing)
	w := doPostWordInContext(t, h, `{"sentence":"I deposited cash at the bank.","word":"bank"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
	if len(ledger.settleCalls) != 0 {
		t.Fatalf("a failed translation must not be billed, got: %+v", ledger.settleCalls)
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
	h := NewHandler(&fakeTranslator{chinese: "unused"}, &fakeTokenLedger{balance: 100}, tokenTestPricing)
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
	tr := &fakeTranslator{swwsResult: sentenceword.WordsResult{SentenceChinese: "x"}, usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 0}
	h := NewHandler(tr, ledger, tokenTestPricing)
	w := doPostSentenceWithWords(t, h, `{"sentence":"I deposited cash at the bank.","words":[{"word":"bank"}]}`)

	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("status: got %d want 402, body=%s", w.Code, w.Body.String())
	}
	if tr.callCount != 0 {
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
	tr := &fakeTranslator{
		swwsResult: sentenceword.WordsResult{
			SentenceChinese: "我在银行存了现金。",
			Words: []sentenceword.WordGloss{
				{Word: "bank", Chinese: "银行", Why: ""},
				{Word: "cash", Chinese: "", Why: ""},
			},
		},
		usage: usageCosting2,
	}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(tr, ledger, tokenTestPricing)
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
	if len(tr.wordsIn) != 2 || tr.wordsIn[0].DictionaryChinese != "银行" || tr.wordsIn[1].Word != "cash" {
		t.Fatalf("provider input: %+v", tr.wordsIn)
	}
	if tr.callCount != 1 {
		t.Fatalf("expected one provider call, got %d", tr.callCount)
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
		tr := &fakeTranslator{}
		ledger := &fakeTokenLedger{balance: 100}
		h := NewHandler(tr, ledger, tokenTestPricing)
		w := doPostSentenceWithWords(t, h, body)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: status got %d want 400", body, w.Code)
		}
		if tr.callCount != 0 || ledger.balanceCalls != 0 || len(ledger.settleCalls) != 0 {
			t.Errorf("%s: provider calls=%d, balance calls=%d, settlements=%d",
				body, tr.callCount, ledger.balanceCalls, len(ledger.settleCalls))
		}
	}
}

func TestSentenceWithWordsHandlerMissingSentenceIs502Unbilled(t *testing.T) {
	tr := &fakeTranslator{err: errors.New("sentenceword: reply has no sentence translation"), usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(tr, ledger, tokenTestPricing)
	w := doPostSentenceWithWords(t, h, `{"sentence":"I bank.","words":[{"word":"bank"}]}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
	if len(ledger.settleCalls) != 0 {
		t.Fatalf("a failed call must not be billed, got: %+v", ledger.settleCalls)
	}
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
			tr := &fakeTranslator{chinese: "unused", usage: usageCosting2}
			ledger := &fakeTokenLedger{balance: 100}
			h := NewHandler(tr, ledger, tokenTestPricing).WithTrialGate(&fakeGate{verdict: tc.verdict})
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
			if tr.callCount != 0 || len(ledger.settleCalls) != 0 {
				t.Fatal("a limited call must not reach the provider or be billed")
			}
		})
	}
}

// The balance pre-check runs first: a broke trial user is told to pay, and
// the refused call doesn't use up a trial slot.
func TestHandlerBrokeUserGets402WithoutUsingTrialSlot(t *testing.T) {
	gate := &fakeGate{verdict: ailimit.Allowed}
	h := NewHandler(&fakeTranslator{chinese: "unused"}, &fakeTokenLedger{balance: 0}, tokenTestPricing).WithTrialGate(gate)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusPaymentRequired || gate.checks != 0 {
		t.Fatalf("status=%d gate checks=%d, want 402 and 0", w.Code, gate.checks)
	}
}
