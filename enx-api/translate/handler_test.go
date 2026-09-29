package translate

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"enx-api/dictionary"

	"github.com/gin-gonic/gin"
)

type fakeResolver struct {
	res dictionary.Result
	err error
}

func (f fakeResolver) Resolve(context.Context, string, string) (dictionary.Result, error) {
	return f.res, f.err
}

type fakeReviewLog struct {
	count, acquainted int
	err               error
	calls             int
}

func (f *fakeReviewLog) RecordWordLookup(string, string) (int, int, error) {
	f.calls++
	return f.count, f.acquainted, f.err
}

func serve(t *testing.T, h *Handler, word string) (int, lookupResponse) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, w := translateCtx(word, "u1")
	h.translateWord(c, word)
	var resp lookupResponse
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
	}
	return w.Code, resp
}

func TestHandlerMapsResolverErrorsToStatus(t *testing.T) {
	// RespondQuotaExceeded reads the caller's subscription to word its 429.
	setupQuotaTestDB(t)
	for _, tc := range []struct {
		err  error
		want int
	}{
		{dictionary.ErrEcdictUnavailable, http.StatusServiceUnavailable},
		{dictionary.ErrQuotaExceeded, http.StatusTooManyRequests},
		{errors.New("db down"), http.StatusBadGateway},
	} {
		reviews := &fakeReviewLog{}
		code, _ := serve(t, NewHandler(fakeResolver{err: tc.err}, reviews), "run")
		if code != tc.want || reviews.calls != 0 {
			t.Errorf("%v: got %d with %d review writes, want %d and none", tc.err, code, reviews.calls, tc.want)
		}
	}
}

func TestHandlerReportsReviewCounts(t *testing.T) {
	reviews := &fakeReviewLog{count: 4}
	res := dictionary.Result{ID: "w1", English: "run", Chinese: "v. 跑", Source: dictionary.SourceLocal}

	code, resp := serve(t, NewHandler(fakeResolver{res: res}, reviews), "run")
	if code != http.StatusOK || resp.Id != "w1" || resp.Chinese != "v. 跑" || resp.LoadCount != 4 || reviews.calls != 1 {
		t.Fatalf("got %d %+v with %d review writes, want 200, w1, LoadCount 4, one write", code, resp, reviews.calls)
	}
}

func TestHandlerSkipsReviewLogOnMiss(t *testing.T) {
	reviews := &fakeReviewLog{}
	res := dictionary.Result{English: "zzxqv", Source: dictionary.SourceMiss}

	code, resp := serve(t, NewHandler(fakeResolver{res: res}, reviews), "zzxqv")
	if code != http.StatusOK || resp.Id != "" || reviews.calls != 0 {
		t.Fatalf("got %d %+v with %d review writes, want 200, no id, no writes", code, resp, reviews.calls)
	}
}

// A failed review write still answers with the definition.
func TestHandlerAnswersWhenReviewLogFails(t *testing.T) {
	reviews := &fakeReviewLog{err: errors.New("locked")}
	res := dictionary.Result{ID: "w1", English: "run", Chinese: "v. 跑", Source: dictionary.SourceLocal}

	code, resp := serve(t, NewHandler(fakeResolver{res: res}, reviews), "run")
	if code != http.StatusOK || resp.Chinese != "v. 跑" || resp.LoadCount != 0 {
		t.Fatalf("got %d %+v, want 200 with the definition and LoadCount 0", code, resp)
	}
}
