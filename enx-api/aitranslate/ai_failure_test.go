package aitranslate

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"enx-api/billing/credit"
)

// A 502 says which side failed (#1153): ENX before the model was called, or
// the upstream AI service. The whole body is pinned, copy included.
func TestAIFailureSaysWhichSideFailed(t *testing.T) {
	internal := map[string]any{"success": false, "code": "internal_error", "message": "Something went wrong on our side. Please try again later."}
	upstream := map[string]any{"success": false, "code": "ai_upstream_failed", "message": "The AI service is having trouble right now. Please try again."}

	type setup struct {
		name       string
		notWired   bool
		pricing    credit.TokenPricing
		balanceErr error
		modelErr   error
		want       map[string]any
	}
	cases := []setup{
		{name: "not configured", notWired: true, pricing: tokenTestPricing, want: internal},
		{name: "unpriced", want: internal},
		{name: "balance error", pricing: tokenTestPricing, balanceErr: errors.New("db down"), want: internal},
		{name: "model error", pricing: tokenTestPricing, modelErr: errors.New("provider timeout"), want: upstream},
	}

	translate := func(post func(*testing.T, *Handler, string) *httptest.ResponseRecorder, body string) func(*testing.T, setup) *httptest.ResponseRecorder {
		return func(t *testing.T, s setup) *httptest.ResponseRecorder {
			var tr Translator
			if !s.notWired {
				tr = &fakeTranslator{err: s.modelErr}
			}
			return post(t, NewHandler(tr, &fakeTokenLedger{balance: 100, balanceErr: s.balanceErr}, s.pricing), body)
		}
	}
	endpoints := map[string]func(*testing.T, setup) *httptest.ResponseRecorder{
		"sentence":            translate(doPost, `{"sentence":"I bank."}`),
		"word-in-context":     translate(doPostWordInContext, `{"sentence":"I bank.","word":"bank"}`),
		"sentence-with-words": translate(doPostSentenceWithWords, `{"sentence":"I bank.","words":[{"word":"bank"}]}`),
		"rephrase": func(t *testing.T, s setup) *httptest.ResponseRecorder {
			ledger := &fakeRephraseLedger{balance: 100, balanceErr: s.balanceErr}
			h := NewRephraseHandler(&fakeRephraser{err: s.modelErr}, ledger, s.pricing)
			if s.notWired {
				h = NewRephraseHandler(nil, ledger, s.pricing)
			}
			return doRephrase(t, h, `{"input":"hi"}`)
		},
	}

	for endpoint, call := range endpoints {
		for _, s := range cases {
			t.Run(endpoint+"/"+s.name, func(t *testing.T) {
				w := call(t, s)

				if w.Code != http.StatusBadGateway {
					t.Fatalf("status = %d, want 502: %s", w.Code, w.Body)
				}
				var got map[string]any
				if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
					t.Fatalf("response is not JSON: %v: %s", err, w.Body)
				}
				if !reflect.DeepEqual(got, s.want) {
					t.Fatalf("body = %s, want %v", w.Body, s.want)
				}
			})
		}
	}
}
