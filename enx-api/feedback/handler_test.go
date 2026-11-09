package feedback_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"enx-api/feedback"
	"enx-api/feedback/adapters"
	"enx-api/utils/sqlitex"
)

// 10:00 UTC on a Monday; the UTC day under test runs from 00:00 that day.
var today = time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC)

type recordingNotifier struct {
	mu   sync.Mutex
	sent []feedback.Record
}

func (n *recordingNotifier) NotifyNewFeedback(r feedback.Record) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.sent = append(n.sent, r)
	return nil
}

type env struct {
	t        *testing.T
	now      time.Time
	notifier *recordingNotifier
	router   *gin.Engine
}

// newEnv serves the feedback routes over a fresh database with the
// production repository, a fixed clock and the default daily limit of 50.
// The caller's user id travels in X-Test-User, standing in for clerkAuth.
func newEnv(t *testing.T) *env {
	t.Helper()
	return newEnvWith(t, adapters.Table{})
}

func newEnvWith(t *testing.T, store feedback.Store) *env {
	t.Helper()
	prev := sqlitex.DB
	if err := sqlitex.InitWithLogLevel(filepath.Join(t.TempDir(), "feedback.db"), "warn"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlitex.DB = prev })

	e := &env{t: t, now: today, notifier: &recordingNotifier{}}
	h := feedback.NewHandler(feedback.NewService(store, e.notifier, 50, func() time.Time { return e.now }))
	gin.SetMode(gin.TestMode)
	e.router = gin.New()
	e.router.Use(func(c *gin.Context) {
		c.Set("user_id", c.GetHeader("X-Test-User"))
		c.Next()
	})
	e.router.POST("/api/feedback", h.Submit)
	e.router.GET("/api/admin/feedback", h.List)
	e.router.PATCH("/api/admin/feedback/:id", h.Resolve)
	return e
}

func (e *env) do(method, path, user, body string) *httptest.ResponseRecorder {
	e.t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-User", user)
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, req)
	return w
}

func pageReport(url, reason string) string {
	return fmt.Sprintf(`{"kind":"page_report","url":%q,"context":{"adapter":"x","extVersion":"1.0.1"},"details":{"reason":%q}}`, url, reason)
}

func (e *env) submit(user, body string) *httptest.ResponseRecorder {
	e.t.Helper()
	return e.do(http.MethodPost, "/api/feedback", user, body)
}

type submitResponse struct {
	Success  bool   `json:"success"`
	Recorded bool   `json:"recorded"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

func decode[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %s: %v", w.Body.String(), err)
	}
	return v
}

// wantRecorded asserts a 200 with the given recorded flag.
func (e *env) wantRecorded(w *httptest.ResponseRecorder, want bool) {
	e.t.Helper()
	if w.Code != http.StatusOK {
		e.t.Fatalf("status %d body=%s, want 200", w.Code, w.Body.String())
	}
	if r := decode[submitResponse](e.t, w); !r.Success || r.Recorded != want {
		e.t.Fatalf("response %+v, want success with recorded=%v", r, want)
	}
}

func rows(t *testing.T, user string) []sqlitex.Feedback {
	t.Helper()
	var out []sqlitex.Feedback
	if err := sqlitex.DB.Where("user_id = ?", user).Order("created_at, id").Find(&out).Error; err != nil {
		t.Fatal(err)
	}
	return out
}

// seed inserts records directly, standing in for kinds whose submitters have
// not shipped yet.
func seed(t *testing.T, user, kind string, at time.Time, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		row := sqlitex.Feedback{
			ID: fmt.Sprintf("%s-%s-%d-%d", user, kind, at.UnixMilli(), i), UserID: user, Kind: kind,
			URL: fmt.Sprintf("https://seed.example/%d", i), Host: "seed.example",
			Context: "{}", Details: "{}", Status: "new", CreatedAt: at.UnixMilli(),
		}
		if err := sqlitex.DB.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func TestSubmitStoresAPageReportWithTheURLTheServerCleaned(t *testing.T) {
	e := newEnv(t)

	e.wantRecorded(e.submit("u1", pageReport("https://User:pw@X.com/unsub/jane@example.com/status/1?s=20#top", "no-article-node")), true)

	got := rows(t, "u1")
	if len(got) != 1 {
		t.Fatalf("rows = %d, want 1", len(got))
	}
	r := got[0]
	if r.Kind != "page_report" || r.URL != "https://x.com/unsub/:redacted/status/1" || r.Host != "x.com" ||
		r.Text != "" || r.Status != "new" || r.CreatedAt != today.UnixMilli() {
		t.Fatalf("row = %+v", r)
	}
	if r.Details != `{"reason":"no-article-node"}` || r.Context != `{"adapter":"x","extVersion":"1.0.1"}` {
		t.Fatalf("details = %s, context = %s", r.Details, r.Context)
	}
}

func TestSubmitRejectsInvalidInput(t *testing.T) {
	e := newEnv(t)
	long := "https://example.com/" + strings.Repeat("a/", 600)
	for name, body := range map[string]string{
		"not json":                `nope`,
		"no kind":                 `{"url":"https://x.com/a","details":{"reason":"error"}}`,
		"unknown kind":            `{"kind":"bug","url":"https://x.com/a"}`,
		"text not yet accepted":   `{"kind":"text","url":"https://x.com/a","text":"broken"}`,
		"article choice not yet":  `{"kind":"article_choice","url":"https://x.com/a","details":{"selector":"main"}}`,
		"definition not yet":      `{"kind":"definition","url":"https://x.com/a","details":{"word":"run"}}`,
		"page report with text":   `{"kind":"page_report","url":"https://x.com/a","text":"hi","details":{"reason":"error"}}`,
		"not http":                pageReport("chrome://extensions", "error"),
		"raw url over 4096 bytes": pageReport("https://x.com/a?"+strings.Repeat("q", 4097), "error"),
		"clean url over 1024":     pageReport(long, "error"),
		"unknown reason":          pageReport("https://x.com/a", "lookup-failed"),
		"no details":              `{"kind":"page_report","url":"https://x.com/a"}`,
		"bad adapter":             `{"kind":"page_report","url":"https://x.com/a","context":{"adapter":"A B"},"details":{"reason":"error"}}`,
		"bad version":             `{"kind":"page_report","url":"https://x.com/a","context":{"extVersion":"1 0"},"details":{"reason":"error"}}`,
	} {
		if w := e.submit("u1", body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d body=%s, want 400", name, w.Code, w.Body.String())
		}
	}
	if n := len(rows(t, "u1")); n != 0 {
		t.Fatalf("rows = %d, want none", n)
	}
}

func TestSubmitKeepsOnePageReportPerPageAndReasonWithin24Hours(t *testing.T) {
	e := newEnv(t)

	e.wantRecorded(e.submit("u1", pageReport("https://x.com/a/status/1", "no-article-node")), true)
	// Differing only in what cleaning strips: the same page.
	e.now = today.Add(23 * time.Hour)
	e.wantRecorded(e.submit("u1", pageReport("https://x.com/a/status/1?s=99", "no-article-node")), false)
	e.wantRecorded(e.submit("u1", pageReport("https://x.com/a/status/1", "no-words")), true)
	e.wantRecorded(e.submit("u2", pageReport("https://x.com/a/status/1", "no-article-node")), true)
	e.now = today.Add(25 * time.Hour)
	e.wantRecorded(e.submit("u1", pageReport("https://x.com/a/status/1", "no-article-node")), true)

	if n := len(rows(t, "u1")); n != 3 {
		t.Fatalf("rows = %d, want 3", n)
	}
}

func TestSubmitRejectsThe51stRecordOfTheUTCDayAcrossKinds(t *testing.T) {
	e := newEnv(t)
	midnight := time.Date(2026, 11, 9, 0, 0, 0, 0, time.UTC)
	seed(t, "u1", "text", midnight, 20)
	seed(t, "u1", "article_choice", midnight.Add(time.Hour), 20)
	seed(t, "u1", "definition", midnight.Add(2*time.Hour), 9)
	// The previous UTC day does not count.
	seed(t, "u1", "text", midnight.Add(-time.Millisecond), 10)

	e.wantRecorded(e.submit("u1", pageReport("https://x.com/fiftieth", "error")), true)
	w := e.submit("u1", pageReport("https://x.com/fifty-first", "error"))
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("51st: status %d body=%s, want 429", w.Code, w.Body.String())
	}
	if r := decode[submitResponse](t, w); r.Success || r.Code != "feedback_limit_exceeded" ||
		r.Message != "Daily feedback limit reached. Please try again tomorrow." {
		t.Fatalf("51st: response %+v", r)
	}
	if n := len(rows(t, "u1")); n != 60 {
		t.Fatalf("rows = %d, want 60 (no row for the rejected one)", n)
	}

	e.now = time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	e.wantRecorded(e.submit("u1", pageReport("https://x.com/next-day", "error")), true)
}

func TestSubmitAnswersARepeatPageReportAsDoneEvenAtTheLimit(t *testing.T) {
	e := newEnv(t)
	seed(t, "u1", "text", today.Add(-time.Hour), 49)
	e.wantRecorded(e.submit("u1", pageReport("https://x.com/a", "error")), true)

	e.wantRecorded(e.submit("u1", pageReport("https://x.com/a", "error")), false)
	if n := len(rows(t, "u1")); n != 50 {
		t.Fatalf("rows = %d, want 50", n)
	}
}

// slowStore is the production store with every insert held back, so that
// submissions racing through a non-atomic check-then-insert would all pass
// their checks before any of them writes.
type slowStore struct{ adapters.Table }

type slowAdmission struct{ feedback.Admission }

func (s slowStore) Admit(ctx context.Context, fn func(feedback.Admission) error) error {
	return s.Table.Admit(ctx, func(a feedback.Admission) error { return fn(slowAdmission{a}) })
}

func (a slowAdmission) Insert(r feedback.Record) error {
	time.Sleep(20 * time.Millisecond)
	return a.Admission.Insert(r)
}

func TestSubmitAdmitsNoMoreThanTheLimitUnderConcurrentSubmissions(t *testing.T) {
	e := newEnvWith(t, slowStore{})
	seed(t, "u1", "text", today.Add(-time.Hour), 47)

	codes := make([]int, 12)
	var wg sync.WaitGroup
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			// Two submissions per page: the duplicate must not add a row.
			codes[i] = e.submit("u1", pageReport(fmt.Sprintf("https://x.com/page-%d", i/2), "error")).Code
		}(i)
	}
	wg.Wait()

	if n := len(rows(t, "u1")); n != 50 {
		t.Fatalf("rows = %d, want exactly the limit of 50", n)
	}
	limited := 0
	for _, c := range codes {
		switch c {
		case http.StatusTooManyRequests:
			limited++
		case http.StatusOK:
		default:
			t.Fatalf("unexpected status %d", c)
		}
	}
	if limited == 0 {
		t.Fatal("no submission was refused, want 429 once the limit was reached")
	}
	pages := map[string]int{}
	for _, r := range rows(t, "u1") {
		if r.Kind == "page_report" {
			pages[r.URL]++
		}
	}
	for url, n := range pages {
		if n != 1 {
			t.Errorf("%s stored %d times, want once", url, n)
		}
	}
}

func TestSubmitNotifiesTheAdminOnlyOfANewPageReport(t *testing.T) {
	e := newEnv(t)

	e.submit("u1", pageReport("https://x.com/a?s=1", "no-words"))
	e.submit("u1", pageReport("https://x.com/a", "no-words"))
	e.submit("u1", pageReport("chrome://extensions", "no-words"))

	if len(e.notifier.sent) != 1 {
		t.Fatalf("notifications = %d, want 1", len(e.notifier.sent))
	}
	n := e.notifier.sent[0]
	pr, ok := n.PageReport()
	if n.Kind != feedback.KindPageReport || n.URL != "https://x.com/a" || n.Host != "x.com" || n.UserID != "u1" ||
		!ok || pr.Reason != "no-words" || pr.Adapter != "x" || pr.ExtVersion != "1.0.1" {
		t.Fatalf("notification = %+v (%+v)", n, pr)
	}
}

type listResponse struct {
	Success  bool `json:"success"`
	Feedback []struct {
		ID        string         `json:"id"`
		UserID    string         `json:"userId"`
		Kind      string         `json:"kind"`
		URL       string         `json:"url"`
		Host      string         `json:"host"`
		Text      string         `json:"text"`
		Context   map[string]any `json:"context"`
		Details   map[string]any `json:"details"`
		Status    string         `json:"status"`
		CreatedAt int64          `json:"createdAt"`
	} `json:"feedback"`
	NextOffset *int `json:"nextOffset"`
}

func (e *env) list(query string) listResponse {
	e.t.Helper()
	w := e.do(http.MethodGet, "/api/admin/feedback"+query, "admin", "")
	if w.Code != http.StatusOK {
		e.t.Fatalf("GET %s: status %d body=%s", query, w.Code, w.Body.String())
	}
	return decode[listResponse](e.t, w)
}

func TestListShowsEveryFieldNewestFirst(t *testing.T) {
	e := newEnv(t)
	e.wantRecorded(e.submit("u1", pageReport("https://x.com/first", "error")), true)
	e.now = today.Add(time.Minute)
	e.wantRecorded(e.submit("u2", pageReport("https://x.com/second", "no-words")), true)

	got := e.list("")
	if !got.Success || len(got.Feedback) != 2 || got.NextOffset != nil {
		t.Fatalf("list = %+v", got)
	}
	f := got.Feedback[0]
	if f.ID == "" || f.UserID != "u2" || f.Kind != "page_report" || f.URL != "https://x.com/second" || f.Host != "x.com" ||
		f.Text != "" || f.Status != "new" || f.CreatedAt != today.Add(time.Minute).UnixMilli() ||
		f.Details["reason"] != "no-words" || f.Context["adapter"] != "x" || f.Context["extVersion"] != "1.0.1" {
		t.Fatalf("newest = %+v", f)
	}
	if got.Feedback[1].URL != "https://x.com/first" {
		t.Fatalf("second = %+v", got.Feedback[1])
	}
}

func TestListFiltersOnTheServerBeforePaging(t *testing.T) {
	e := newEnv(t)
	seed(t, "u1", "page_report", today.Add(-time.Hour), 150)
	seed(t, "u2", "page_report", today.Add(-2*time.Hour), 100)
	seed(t, "u1", "text", today, 30)
	if err := sqlitex.DB.Model(&sqlitex.Feedback{}).Where("user_id = ? AND kind = ?", "u2", "page_report").
		Update("status", "resolved").Error; err != nil {
		t.Fatal(err)
	}

	first := e.list("?kind=page_report&status=new")
	if len(first.Feedback) != 100 || first.NextOffset == nil || *first.NextOffset != 100 {
		t.Fatalf("first page: %d rows, nextOffset %v", len(first.Feedback), first.NextOffset)
	}
	second := e.list("?kind=page_report&status=new&offset=100")
	if len(second.Feedback) != 50 || second.NextOffset != nil {
		t.Fatalf("second page: %d rows, nextOffset %v", len(second.Feedback), second.NextOffset)
	}
	seen := map[string]bool{}
	for _, f := range append(first.Feedback, second.Feedback...) {
		if f.Kind != "page_report" || f.Status != "new" || seen[f.ID] {
			t.Fatalf("unexpected row %+v", f)
		}
		seen[f.ID] = true
	}
	// Same created time: id descending breaks the tie.
	if first.Feedback[0].ID < first.Feedback[1].ID {
		t.Fatalf("ids not descending: %s then %s", first.Feedback[0].ID, first.Feedback[1].ID)
	}

	resolved := e.list("?status=resolved&limit=200")
	if len(resolved.Feedback) != 100 || resolved.NextOffset != nil {
		t.Fatalf("resolved: %d rows, nextOffset %v", len(resolved.Feedback), resolved.NextOffset)
	}
	all := e.list("?limit=200")
	if len(all.Feedback) != 200 || all.NextOffset == nil || *all.NextOffset != 200 || all.Feedback[0].Kind != "text" {
		t.Fatalf("all: %d rows, nextOffset %v, newest %+v", len(all.Feedback), all.NextOffset, all.Feedback[0])
	}
}

func TestListRejectsInvalidFiltersAndPaging(t *testing.T) {
	e := newEnv(t)
	for _, q := range []string{"?kind=bug", "?status=open", "?limit=0", "?limit=201", "?limit=ten", "?offset=-1", "?offset=x"} {
		if w := e.do(http.MethodGet, "/api/admin/feedback"+q, "admin", ""); w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", q, w.Code)
		}
	}
}

func TestResolveMarksARecordResolvedAndKeepsIt(t *testing.T) {
	e := newEnv(t)
	e.wantRecorded(e.submit("u1", pageReport("https://x.com/a", "error")), true)
	id := rows(t, "u1")[0].ID

	for i := 0; i < 2; i++ {
		w := e.do(http.MethodPatch, "/api/admin/feedback/"+id, "admin", `{"status":"resolved"}`)
		if w.Code != http.StatusOK || w.Body.String() != `{"success":true}` {
			t.Fatalf("resolve %d: status %d body=%s", i+1, w.Code, w.Body.String())
		}
	}
	if got := rows(t, "u1"); len(got) != 1 || got[0].Status != "resolved" {
		t.Fatalf("rows = %+v, want the record kept as resolved", got)
	}

	if w := e.do(http.MethodPatch, "/api/admin/feedback/nope", "admin", `{"status":"resolved"}`); w.Code != http.StatusNotFound {
		t.Errorf("unknown id: status %d, want 404", w.Code)
	}
	for _, body := range []string{`{"status":"new"}`, `{}`, `nope`} {
		if w := e.do(http.MethodPatch, "/api/admin/feedback/"+id, "admin", body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", body, w.Code)
		}
	}
}
