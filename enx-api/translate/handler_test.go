package translate

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"enx-api/dictionary"
	"enx-api/metrics"

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
	count int
	known bool
	err   error
	calls int
}

func (f *fakeReviewLog) ReviewState(string, string) (int, bool, error) {
	f.calls++
	return f.count, f.known, f.err
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
			t.Errorf("%v: got %d with %d review reads, want %d and none", tc.err, code, reviews.calls, tc.want)
		}
	}
}

func TestHandlerReportsReviewCounts(t *testing.T) {
	reviews := &fakeReviewLog{count: 4}
	res := dictionary.Result{ID: "w1", English: "run", Chinese: "v. 跑", Source: dictionary.SourceLocal}

	code, resp := serve(t, NewHandler(fakeResolver{res: res}, reviews), "run")
	if code != http.StatusOK || resp.Id != "w1" || resp.Chinese != "v. 跑" || resp.LoadCount != 4 || reviews.calls != 1 {
		t.Fatalf("got %d %+v with %d review reads, want 200, w1, LoadCount 4, one read", code, resp, reviews.calls)
	}
}

func TestHandlerSkipsReviewLogOnMiss(t *testing.T) {
	reviews := &fakeReviewLog{}
	res := dictionary.Result{English: "zzxqv", Source: dictionary.SourceMiss}

	code, resp := serve(t, NewHandler(fakeResolver{res: res}, reviews), "zzxqv")
	if code != http.StatusOK || resp.Id != "" || reviews.calls != 0 {
		t.Fatalf("got %d %+v with %d review reads, want 200, no id, no reads", code, resp, reviews.calls)
	}
}

// A failed review read still answers with the definition.
func TestHandlerAnswersWhenReviewLogFails(t *testing.T) {
	reviews := &fakeReviewLog{err: errors.New("locked")}
	res := dictionary.Result{ID: "w1", English: "run", Chinese: "v. 跑", Source: dictionary.SourceLocal}

	code, resp := serve(t, NewHandler(fakeResolver{res: res}, reviews), "run")
	if code != http.StatusOK || resp.Chinese != "v. 跑" || resp.LoadCount != 0 {
		t.Fatalf("got %d %+v, want 200 with the definition and LoadCount 0", code, resp)
	}
}

// ADR-040: a completed lookup tells the client which source answered it, on
// both lookup routes, so a client can tell a timeout from a miss.
func TestLookupRoutesSendTheSource(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, source := range []dictionary.Source{
		dictionary.SourceLocal, dictionary.SourceEcdict, dictionary.SourceMiss,
		dictionary.SourceTimeout, dictionary.SourceError,
	} {
		h := NewHandler(fakeResolver{res: dictionary.Result{English: "run", Source: source}}, &fakeReviewLog{})
		r := gin.New()
		r.Use(func(c *gin.Context) { c.Set("user_id", "u1") })
		r.GET("/api/translate", h.Translate)
		r.GET("/api/word/:word", h.TranslateByWord)
		for _, path := range []string{"/api/translate?word=run", "/api/word/run"} {
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("%s (%s): %v: %s", path, source, err, w.Body)
			}
			if w.Code != http.StatusOK || body["Source"] != string(source) {
				t.Errorf("%s: got %d Source=%v, want 200 Source=%q", path, w.Code, body["Source"], source)
			}
		}
	}
}

// ADR-040: the handler tags a completed lookup with its source, which the
// metrics middleware turns into the lookup-latency histogram.
func TestHandlerTagsLookupSource(t *testing.T) {
	for _, tc := range []struct {
		res  dictionary.Result
		err  error
		want string
	}{
		{dictionary.Result{ID: "w1", English: "run", Source: dictionary.SourceLocal}, nil, "local"},
		{dictionary.Result{ID: "w2", English: "run", Source: dictionary.SourceEcdict}, nil, "ecdict"},
		{dictionary.Result{English: "zzxqv", Source: dictionary.SourceMiss}, nil, "miss"},
		// A lookup that never completed is not a lookup-latency sample.
		{dictionary.Result{}, dictionary.ErrEcdictUnavailable, ""},
	} {
		gin.SetMode(gin.TestMode)
		c, _ := translateCtx("run", "u1")
		NewHandler(fakeResolver{res: tc.res, err: tc.err}, &fakeReviewLog{}).translateWord(c, "run")
		if got := c.GetString(metrics.LookupSourceKey); got != tc.want {
			t.Errorf("source %q / err %v: tagged %q, want %q", tc.res.Source, tc.err, got, tc.want)
		}
	}
}

type subscriberForQuota bool

func (s subscriberForQuota) IsActiveSubscriber(context.Context, string) (bool, error) {
	return bool(s), nil
}

func TestQuotaResponseUsesInjectedSubscription(t *testing.T) {
	for _, tc := range []struct {
		active bool
		want   string
	}{{true, "contact support"}, {false, "Upgrade"}} {
		c, w := translateCtx("run", "u1")
		h := NewHandler(fakeResolver{err: dictionary.ErrQuotaExceeded}, &fakeReviewLog{}).WithSubscriptions(subscriberForQuota(tc.active))
		h.Translate(c)
		if w.Code != http.StatusTooManyRequests || !strings.Contains(w.Body.String(), tc.want) {
			t.Fatalf("active %v: %d %s", tc.active, w.Code, w.Body.String())
		}
	}
}
