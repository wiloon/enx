package aitranslate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/billing/credit"

	"github.com/gin-gonic/gin"
)

type fakeTranslator struct {
	chinese string
	err     error
}

func (f *fakeTranslator) TranslateSentence(ctx context.Context, sentence string) (string, error) {
	return f.chinese, f.err
}

func (f *fakeTranslator) TranslateWordInContext(ctx context.Context, sentence, word string) (string, error) {
	return f.chinese, f.err
}

type consumeCall struct {
	userID, feature string
	cost            int64
}

type refundCall struct {
	userID, feature, pool string
	cost                  int64
}

// fakeCreditLedger stands in for the real billing/credit ledger so these
// tests don't need a database -- mirrors fakeTranslator's role for the AI
// provider.
type fakeCreditLedger struct {
	consumeErr   error
	consumePool  string // defaults to credit.PoolSubscription if empty
	refundErr    error
	consumeCalls []consumeCall
	refundCalls  []refundCall
}

func (f *fakeCreditLedger) Consume(ctx context.Context, userID, feature string, cost int64) (string, error) {
	f.consumeCalls = append(f.consumeCalls, consumeCall{userID, feature, cost})
	if f.consumeErr != nil {
		return "", f.consumeErr
	}
	pool := f.consumePool
	if pool == "" {
		pool = credit.PoolSubscription
	}
	return pool, nil
}

func (f *fakeCreditLedger) Refund(ctx context.Context, userID, feature, pool string, cost int64) error {
	f.refundCalls = append(f.refundCalls, refundCall{userID, feature, pool, cost})
	return f.refundErr
}

func doPost(t *testing.T, h *Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/translate/sentence", h.TranslateSentence)

	req := httptest.NewRequest(http.MethodPost, "/api/translate/sentence", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func doPostWordInContext(t *testing.T, h *Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/translate/word-in-context", h.TranslateWordInContext)

	req := httptest.NewRequest(http.MethodPost, "/api/translate/word-in-context", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func TestHandlerSuccess(t *testing.T) {
	credits := &fakeCreditLedger{}
	h := NewHandler(&fakeTranslator{chinese: "你好世界"}, credits, 1, 1)
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

	if len(credits.consumeCalls) != 1 || credits.consumeCalls[0].feature != "translate_sentence" || credits.consumeCalls[0].cost != 1 {
		t.Fatalf("unexpected consume calls: %+v", credits.consumeCalls)
	}
	if len(credits.refundCalls) != 0 {
		t.Fatalf("a successful translation must not be refunded, got: %+v", credits.refundCalls)
	}
}

func TestHandlerTranslatorErrorRefundsCredit(t *testing.T) {
	credits := &fakeCreditLedger{consumePool: credit.PoolTopup}
	h := NewHandler(&fakeTranslator{err: errors.New("upstream timeout")}, credits, 3, 1)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Success {
		t.Fatal("expected success:false")
	}

	if len(credits.refundCalls) != 1 {
		t.Fatalf("expected exactly one refund after a failed translation, got: %+v", credits.refundCalls)
	}
	refund := credits.refundCalls[0]
	if refund.feature != "translate_sentence" || refund.pool != credit.PoolTopup || refund.cost != 3 {
		t.Fatalf("refund didn't match the consumed pool/cost: %+v", refund)
	}
}

func TestHandlerInsufficientCreditReturns402(t *testing.T) {
	credits := &fakeCreditLedger{consumeErr: credit.ErrInsufficientCredit}
	h := NewHandler(&fakeTranslator{chinese: "unused"}, credits, 1, 1)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("status: got %d want 402, body=%s", w.Code, w.Body.String())
	}
	// The provider must never be reached (and thus never refunded) when
	// credit was never actually consumed.
	if len(credits.refundCalls) != 0 {
		t.Fatalf("no refund should happen when Consume itself failed, got: %+v", credits.refundCalls)
	}
}

func TestHandlerNotConfigured(t *testing.T) {
	credits := &fakeCreditLedger{}
	h := NewHandler(nil, credits, 1, 1)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
	// An unconfigured translator fails before any credit is touched.
	if len(credits.consumeCalls) != 0 {
		t.Fatalf("expected no credit consumption when translator is unconfigured, got: %+v", credits.consumeCalls)
	}
}

func TestHandlerMissingSentence(t *testing.T) {
	h := NewHandler(&fakeTranslator{chinese: "unused"}, &fakeCreditLedger{}, 1, 1)
	w := doPost(t, h, `{}`)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400, body=%s", w.Code, w.Body.String())
	}
}

func TestWordInContextHandlerSuccess(t *testing.T) {
	credits := &fakeCreditLedger{}
	h := NewHandler(&fakeTranslator{chinese: "银行"}, credits, 1, 2)
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
	if len(credits.consumeCalls) != 1 || credits.consumeCalls[0].feature != "translate_word_in_context" || credits.consumeCalls[0].cost != 2 {
		t.Fatalf("unexpected consume calls: %+v", credits.consumeCalls)
	}
}

func TestWordInContextHandlerTranslatorErrorRefundsCredit(t *testing.T) {
	credits := &fakeCreditLedger{}
	h := NewHandler(&fakeTranslator{err: errors.New("upstream timeout")}, credits, 1, 2)
	w := doPostWordInContext(t, h, `{"sentence":"I deposited cash at the bank.","word":"bank"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
	if len(credits.refundCalls) != 1 || credits.refundCalls[0].cost != 2 {
		t.Fatalf("expected exactly one refund of cost 2, got: %+v", credits.refundCalls)
	}
}

func TestWordInContextHandlerNotConfigured(t *testing.T) {
	h := NewHandler(nil, &fakeCreditLedger{}, 1, 1)
	w := doPostWordInContext(t, h, `{"sentence":"I deposited cash at the bank.","word":"bank"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
}

func TestWordInContextHandlerMissingFields(t *testing.T) {
	h := NewHandler(&fakeTranslator{chinese: "unused"}, &fakeCreditLedger{}, 1, 1)
	w := doPostWordInContext(t, h, `{"sentence":"I deposited cash at the bank."}`)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400, body=%s", w.Code, w.Body.String())
	}
}
