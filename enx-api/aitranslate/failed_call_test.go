package aitranslate

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

// Shared assertions for the failed-call billing rules and log contract
// (ADR-094), used by the translate and rephrase handler tests. Requests there
// carry no signed-in user, so user_id is empty.

func cancelledContext() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return ctx
}

func doPostWithContext(t *testing.T, ctx context.Context, route string, h gin.HandlerFunc, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST(route, h)
	req := httptest.NewRequestWithContext(ctx, http.MethodPost, route, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

// assertBadGateway checks the 502 and the message the feature's handler
// returns: rephrase has its own, every translate feature shares one.
func assertBadGateway(t *testing.T, w *httptest.ResponseRecorder, feature string) {
	t.Helper()
	want := "translation service unavailable"
	if feature == "rephrase_to_english" {
		want = "Rephrase service unavailable."
	}
	if w.Code != http.StatusBadGateway || !strings.Contains(w.Body.String(), want) {
		t.Fatalf("response = %d %s, want 502 %q", w.Code, w.Body.String(), want)
	}
}

// assertErrorEvent checks that exactly one entry has msg, at Error level with
// exactly these fields.
func assertErrorEvent(t *testing.T, logs *observer.ObservedLogs, msg string, fields map[string]any) {
	t.Helper()
	entries := logs.FilterMessage(msg).All()
	if len(entries) != 1 {
		t.Fatalf("%s entries = %d, want 1; log: %+v", msg, len(entries), logs.All())
	}
	if entries[0].Level != zapcore.ErrorLevel {
		t.Errorf("%s level = %s, want error", msg, entries[0].Level)
	}
	if got := entries[0].ContextMap(); !reflect.DeepEqual(got, fields) {
		t.Errorf("%s fields = %#v, want %#v", msg, got, fields)
	}
}

func errorEntries(logs *observer.ObservedLogs) []observer.LoggedEntry {
	return logs.Filter(func(e observer.LoggedEntry) bool { return e.Level >= zapcore.ErrorLevel }).All()
}

// billedFields is the event for a failure whose usage is 600+900 tokens.
func billedFields(feature string, settled bool, errText string) map[string]any {
	return map[string]any{
		"feature": feature, "user_id": "",
		"prompt_tokens": int64(600), "completion_tokens": int64(900),
		"cost": int64(2), "settled": settled, "error": errText,
	}
}

func assertSettledOnce(t *testing.T, calls []settleCall, feature string) {
	t.Helper()
	if len(calls) != 1 || calls[0] != (settleCall{"", feature, 2}) {
		t.Fatalf("settle calls = %+v, want one of cost 2 for %s", calls, feature)
	}
}

func assertBilledOnFailure(t *testing.T, w *httptest.ResponseRecorder, calls []settleCall, logs *observer.ObservedLogs, feature, errText string) {
	t.Helper()
	assertBadGateway(t, w, feature)
	assertSettledOnce(t, calls, feature)
	assertErrorEvent(t, logs, "ai_call_billed_on_failure", billedFields(feature, true, errText))
	if got := errorEntries(logs); len(got) != 1 {
		t.Errorf("Error entries = %+v, want only the event", got)
	}
}

func assertUnsettledOnFailure(t *testing.T, w *httptest.ResponseRecorder, calls []settleCall, logs *observer.ObservedLogs, feature, errText string) {
	t.Helper()
	assertBadGateway(t, w, feature)
	assertSettledOnce(t, calls, feature)
	assertErrorEvent(t, logs, "ai_call_billed_on_failure", billedFields(feature, false, errText))
	want := "aitranslate: Settle after " + feature + " failed (user= cost=2): db write failed"
	if logs.FilterMessage(want).Len() != 1 || len(errorEntries(logs)) != 2 {
		t.Errorf("Error entries = %+v, want the event and %q", errorEntries(logs), want)
	}
}

func assertUnbilledFailure(t *testing.T, w *httptest.ResponseRecorder, calls []settleCall, logs *observer.ObservedLogs, feature, errText string) {
	t.Helper()
	assertBadGateway(t, w, feature)
	if len(calls) != 0 {
		t.Fatalf("settle calls = %+v, want none", calls)
	}
	assertErrorEvent(t, logs, "ai_call_failed_unbilled", map[string]any{"feature": feature, "user_id": "", "error": errText})
	if got := errorEntries(logs); len(got) != 1 {
		t.Errorf("Error entries = %+v, want only the event", got)
	}
}

func assertCancelledUnbilled(t *testing.T, w *httptest.ResponseRecorder, calls []settleCall, logs *observer.ObservedLogs, feature string) {
	t.Helper()
	assertBadGateway(t, w, feature)
	if len(calls) != 0 {
		t.Fatalf("settle calls = %+v, want none", calls)
	}
	if logs.FilterMessage("ai_call_failed_unbilled").Len() != 0 || len(errorEntries(logs)) != 0 {
		t.Errorf("a cancelled request must not alert; log: %+v", logs.All())
	}
	infos := logs.FilterLevelExact(zapcore.InfoLevel).All()
	if len(infos) != 1 {
		t.Fatalf("Info entries = %+v, want one", infos)
	}
	for _, want := range []string{feature, "user=", "context canceled"} {
		if !strings.Contains(infos[0].Message, want) {
			t.Errorf("Info line %q lacks %q", infos[0].Message, want)
		}
	}
}
