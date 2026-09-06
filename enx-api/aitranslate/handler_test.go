package aitranslate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/aitranslate/sentenceword"
	"enx-api/billing/credit"

	"github.com/gin-gonic/gin"
)

// tokenTestPricing: cost = ceil((prompt*1 + completion*3) / 3000), floored at 1.
var tokenTestPricing = credit.TokenPricing{WeightIn: 1, WeightOut: 3, Divisor: 3000}

type fakeTranslator struct {
	chinese    string
	swwResult  sentenceword.Result
	usage      Usage
	err        error
	sentenceIn string
	wordIn     string
	callCount  int
}

func (f *fakeTranslator) TranslateSentence(ctx context.Context, sentence string) (string, Usage, error) {
	f.callCount++
	f.sentenceIn = sentence
	return f.chinese, f.usage, f.err
}

func (f *fakeTranslator) TranslateWordInContext(ctx context.Context, sentence, word string) (string, Usage, error) {
	f.callCount++
	f.sentenceIn, f.wordIn = sentence, word
	return f.chinese, f.usage, f.err
}

func (f *fakeTranslator) TranslateSentenceWithWord(ctx context.Context, sentence, word string) (sentenceword.Result, Usage, error) {
	f.callCount++
	f.sentenceIn, f.wordIn = sentence, word
	return f.swwResult, f.usage, f.err
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

func doPostSentenceWithWord(t *testing.T, h *Handler, body string) *httptest.ResponseRecorder {
	return doPostTo(t, "/api/translate/sentence-with-word", h.TranslateSentenceWithWord, body)
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
	tr := &fakeTranslator{chinese: "银行", usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(tr, ledger, tokenTestPricing)
	w := doPostWordInContext(t, h, `{"sentence":"I deposited cash at the bank.","word":"bank"}`)

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
	if !resp.Success || resp.Chinese != "银行" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if tr.wordIn != "bank" {
		t.Fatalf("provider got word %q", tr.wordIn)
	}
	if len(ledger.settleCalls) != 1 || ledger.settleCalls[0].feature != "translate_word_in_context" || ledger.settleCalls[0].cost != 2 {
		t.Fatalf("unexpected settle calls: %+v", ledger.settleCalls)
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

// --- TranslateSentenceWithWord (ADR-014) ----------------------------------

func TestSentenceWithWordHandlerSuccess(t *testing.T) {
	tr := &fakeTranslator{
		swwResult: sentenceword.Result{SentenceChinese: "我在银行存了现金。", WordChinese: "银行"},
		usage:     usageCosting2,
	}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(tr, ledger, tokenTestPricing)
	w := doPostSentenceWithWord(t, h, `{"sentence":"I deposited cash at the bank.","word":"bank"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Success     bool   `json:"success"`
		Chinese     string `json:"chinese"`
		WordChinese string `json:"wordChinese"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Success || resp.Chinese != "我在银行存了现金。" || resp.WordChinese != "银行" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if len(ledger.settleCalls) != 1 || ledger.settleCalls[0].feature != "translate_sentence_with_word" || ledger.settleCalls[0].cost != 2 {
		t.Fatalf("unexpected settle calls: %+v", ledger.settleCalls)
	}
}

// The word gloss can be empty (model omitted it) -- still a 200 with the
// sentence translation; the client falls back to a separate call (ADR-014).
func TestSentenceWithWordHandlerEmptyWordGlossStillSucceeds(t *testing.T) {
	tr := &fakeTranslator{
		swwResult: sentenceword.Result{SentenceChinese: "我在银行存了现金。", WordChinese: ""},
		usage:     usageCosting2,
	}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(tr, ledger, tokenTestPricing)
	w := doPostSentenceWithWord(t, h, `{"sentence":"I deposited cash at the bank.","word":"bank"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Success     bool   `json:"success"`
		Chinese     string `json:"chinese"`
		WordChinese string `json:"wordChinese"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Success || resp.Chinese != "我在银行存了现金。" || resp.WordChinese != "" {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if len(ledger.settleCalls) != 1 {
		t.Fatalf("expected the call to still be billed, got: %+v", ledger.settleCalls)
	}
}

func TestSentenceWithWordHandlerTranslatorErrorNotBilled(t *testing.T) {
	tr := &fakeTranslator{err: errors.New("bad JSON from model"), usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 100}
	h := NewHandler(tr, ledger, tokenTestPricing)
	w := doPostSentenceWithWord(t, h, `{"sentence":"I deposited cash at the bank.","word":"bank"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
	if len(ledger.settleCalls) != 0 {
		t.Fatalf("a failed call must not be billed, got: %+v", ledger.settleCalls)
	}
}

func TestSentenceWithWordHandlerInsufficientBalance(t *testing.T) {
	tr := &fakeTranslator{swwResult: sentenceword.Result{SentenceChinese: "x"}, usage: usageCosting2}
	ledger := &fakeTokenLedger{balance: 0}
	h := NewHandler(tr, ledger, tokenTestPricing)
	w := doPostSentenceWithWord(t, h, `{"sentence":"I deposited cash at the bank.","word":"bank"}`)

	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("status: got %d want 402, body=%s", w.Code, w.Body.String())
	}
	if tr.callCount != 0 {
		t.Fatal("a broke user must not reach the provider")
	}
}

func TestSentenceWithWordHandlerNotConfigured(t *testing.T) {
	h := NewHandler(nil, &fakeTokenLedger{balance: 100}, tokenTestPricing)
	w := doPostSentenceWithWord(t, h, `{"sentence":"I deposited cash at the bank.","word":"bank"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
}

func TestSentenceWithWordHandlerMissingFields(t *testing.T) {
	h := NewHandler(&fakeTranslator{}, &fakeTokenLedger{balance: 100}, tokenTestPricing)
	w := doPostSentenceWithWord(t, h, `{"sentence":"I deposited cash at the bank."}`)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400, body=%s", w.Code, w.Body.String())
	}
}
