package aitranslate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"enx-api/aitranslate/rephrase"
	"enx-api/billing/credit"

	"github.com/gin-gonic/gin"
)

// testPricing: cost = ceil((prompt*1 + completion*3) / 3000), floored at 1.
var testPricing = credit.TokenPricing{WeightIn: 1, WeightOut: 3, Divisor: 3000}

type fakeRephraser struct {
	result    rephrase.Result
	err       error
	callInput string
	callCount int
}

func (f *fakeRephraser) Rephrase(ctx context.Context, input string) (rephrase.Result, error) {
	f.callCount++
	f.callInput = input
	return f.result, f.err
}

type settleCall struct {
	userID, feature string
	cost            int64
}

type fakeRephraseLedger struct {
	balance      int64
	balanceErr   error
	settleErr    error
	settleCalls  []settleCall
	balanceCalls int
}

func (f *fakeRephraseLedger) Balance(ctx context.Context, userID string) (int64, error) {
	f.balanceCalls++
	return f.balance, f.balanceErr
}

func (f *fakeRephraseLedger) Settle(ctx context.Context, userID, feature string, cost int64) error {
	f.settleCalls = append(f.settleCalls, settleCall{userID, feature, cost})
	return f.settleErr
}

func doRephrase(t *testing.T, h *RephraseHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/rephrase", h.Rephrase)
	req := httptest.NewRequest(http.MethodPost, "/api/rephrase", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func okResult() rephrase.Result {
	return rephrase.Result{
		Idiomatic:    "Could you review this when you get a chance?",
		Alternatives: []rephrase.Alternative{{Text: "Mind reviewing this?", Register: "casual"}},
		Notes:        []string{"用 when you get a chance 弱化催促。"},
		Usage:        rephrase.Usage{PromptTokens: 600, CompletionTokens: 900},
	}
}

func TestRephraseHandlerSuccess(t *testing.T) {
	rp := &fakeRephraser{result: okResult()}
	ledger := &fakeRephraseLedger{balance: 100}
	h := NewRephraseHandler(rp, ledger, testPricing)

	w := doRephrase(t, h, `{"input":"帮我看下这个"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var got struct {
		Success      bool   `json:"success"`
		Idiomatic    string `json:"idiomatic"`
		Alternatives []struct {
			Text     string `json:"text"`
			Register string `json:"register"`
		} `json:"alternatives"`
		Notes []string `json:"notes"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !got.Success || got.Idiomatic != "Could you review this when you get a chance?" {
		t.Fatalf("body = %s", w.Body.String())
	}
	if len(got.Alternatives) != 1 || got.Alternatives[0].Register != "casual" || len(got.Notes) != 1 {
		t.Fatalf("body = %s", w.Body.String())
	}
	if rp.callInput != "帮我看下这个" {
		t.Fatalf("provider got input %q", rp.callInput)
	}
	// cost = ceil((600*1 + 900*3) / 3000) = ceil(3300/3000) = 2
	if len(ledger.settleCalls) != 1 || ledger.settleCalls[0].cost != 2 ||
		ledger.settleCalls[0].feature != "rephrase_to_english" {
		t.Fatalf("settle calls = %+v", ledger.settleCalls)
	}
}

func TestRephraseHandlerMissingInput(t *testing.T) {
	rp := &fakeRephraser{result: okResult()}
	ledger := &fakeRephraseLedger{balance: 100}
	h := NewRephraseHandler(rp, ledger, testPricing)

	w := doRephrase(t, h, `{}`)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", w.Code)
	}
	if rp.callCount != 0 || len(ledger.settleCalls) != 0 {
		t.Fatal("provider/ledger should not be touched on a bad request")
	}
}

func TestRephraseHandlerInputTooLong(t *testing.T) {
	rp := &fakeRephraser{result: okResult()}
	ledger := &fakeRephraseLedger{balance: 100}
	h := NewRephraseHandler(rp, ledger, testPricing)

	long := ""
	for i := 0; i < 201; i++ {
		long += "字"
	}
	w := doRephrase(t, h, `{"input":"`+long+`"}`)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if rp.callCount != 0 || len(ledger.settleCalls) != 0 {
		t.Fatal("an over-long input must not reach the provider or the ledger")
	}
}

func TestRephraseHandlerNotConfigured(t *testing.T) {
	ledger := &fakeRephraseLedger{balance: 100}
	h := NewRephraseHandler(nil, ledger, testPricing)

	w := doRephrase(t, h, `{"input":"帮我看下这个"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if len(ledger.settleCalls) != 0 {
		t.Fatal("nothing should be charged when rephrase is not configured")
	}
}

func TestRephraseHandlerUnpricedConfig(t *testing.T) {
	rp := &fakeRephraser{result: okResult()}
	ledger := &fakeRephraseLedger{balance: 100}

	for _, tc := range []struct {
		name    string
		pricing credit.TokenPricing
	}{
		{"zero divisor", credit.TokenPricing{WeightIn: 1, WeightOut: 3, Divisor: 0}},
		{"negative divisor", credit.TokenPricing{WeightIn: 1, WeightOut: 3, Divisor: -1}},
		{"both weights zero", credit.TokenPricing{WeightIn: 0, WeightOut: 0, Divisor: 3000}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rp.callCount = 0
			ledger.settleCalls = nil
			h := NewRephraseHandler(rp, ledger, tc.pricing)

			w := doRephrase(t, h, `{"input":"帮我看下这个"}`)

			if w.Code != http.StatusBadGateway {
				t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
			}
			if rp.callCount != 0 || len(ledger.settleCalls) != 0 {
				t.Fatal("an unpriced feature must not call the provider or charge")
			}
		})
	}
}

func TestRephraseHandlerInsufficientBalance(t *testing.T) {
	rp := &fakeRephraser{result: okResult()}
	ledger := &fakeRephraseLedger{balance: 0}
	h := NewRephraseHandler(rp, ledger, testPricing)

	w := doRephrase(t, h, `{"input":"帮我看下这个"}`)

	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if rp.callCount != 0 || len(ledger.settleCalls) != 0 {
		t.Fatal("a broke user must not reach the provider")
	}
}

func TestRephraseHandlerNegativeBalanceIsBlocked(t *testing.T) {
	rp := &fakeRephraser{result: okResult()}
	ledger := &fakeRephraseLedger{balance: -3}
	h := NewRephraseHandler(rp, ledger, testPricing)

	w := doRephrase(t, h, `{"input":"帮我看下这个"}`)

	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestRephraseHandlerBalanceLookupError(t *testing.T) {
	rp := &fakeRephraser{result: okResult()}
	ledger := &fakeRephraseLedger{balanceErr: errors.New("db down")}
	h := NewRephraseHandler(rp, ledger, testPricing)

	w := doRephrase(t, h, `{"input":"帮我看下这个"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d", w.Code)
	}
	if rp.callCount != 0 {
		t.Fatal("provider should not be called if the balance check errored")
	}
}

func TestRephraseHandlerProviderError(t *testing.T) {
	rp := &fakeRephraser{err: errors.New("provider timeout")}
	ledger := &fakeRephraseLedger{balance: 100}
	h := NewRephraseHandler(rp, ledger, testPricing)

	w := doRephrase(t, h, `{"input":"帮我看下这个"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d", w.Code)
	}
	if len(ledger.settleCalls) != 0 {
		t.Fatal("a failed provider call must not be charged")
	}
}

func TestRephraseHandlerSettleErrorStillReturnsResult(t *testing.T) {
	rp := &fakeRephraser{result: okResult()}
	ledger := &fakeRephraseLedger{balance: 100, settleErr: errors.New("db write failed")}
	h := NewRephraseHandler(rp, ledger, testPricing)

	w := doRephrase(t, h, `{"input":"帮我看下这个"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if len(ledger.settleCalls) != 1 {
		t.Fatalf("Settle should have been attempted once, got %d", len(ledger.settleCalls))
	}
}

func TestRephraseHandlerCostFloorsAtOne(t *testing.T) {
	res := okResult()
	res.Usage = rephrase.Usage{PromptTokens: 1, CompletionTokens: 1}
	rp := &fakeRephraser{result: res}
	ledger := &fakeRephraseLedger{balance: 100}
	h := NewRephraseHandler(rp, ledger, testPricing)

	w := doRephrase(t, h, `{"input":"hi"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	if len(ledger.settleCalls) != 1 || ledger.settleCalls[0].cost != 1 {
		t.Fatalf("cost should floor at 1, got %+v", ledger.settleCalls)
	}
}
