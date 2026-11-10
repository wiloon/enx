package feedback_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"enx-api/utils/sqlitex"
)

func articleChoice(url, details string) string {
	return fmt.Sprintf(`{"kind":"article_choice","url":%q,"context":{"adapter":"x","extVersion":"1.0.1"},"details":%s}`, url, details)
}

func choiceOf(selector string) string {
	return fmt.Sprintf(`{"selector":%q,"autoSource":"none"}`, selector)
}

func TestSubmitStoresAnArticleChoiceWithTheURLTheServerCleanedAndNoEmail(t *testing.T) {
	e := newEnv(t)
	details := `{"selector":"main > div.post:nth-child(2)","autoSource":"article","autoSelector":"article[data-x=\"a&b\"]","autoPlatform":"x"}`

	e.wantRecorded(e.submit("u1", articleChoice("https://User:pw@X.com/unsub/jane@example.com/p?s=20#top", details)), true)

	got := rows(t, "u1")
	if len(got) != 1 {
		t.Fatalf("rows = %d, want 1", len(got))
	}
	r := got[0]
	if r.Kind != "article_choice" || r.URL != "https://x.com/unsub/:redacted/p" || r.Host != "x.com" || r.Text != "" || r.Status != "new" {
		t.Fatalf("row = %+v", r)
	}
	if r.Details != details || r.Context != `{"adapter":"x","extVersion":"1.0.1"}` {
		t.Fatalf("details = %s, context = %s", r.Details, r.Context)
	}
	if len(e.notifier.sent) != 0 {
		t.Fatalf("notifications = %+v, want none for an article choice", e.notifier.sent)
	}
}

func TestSubmitAcceptsArticleChoicesAtTheEdgesOfValid(t *testing.T) {
	e := newEnv(t)
	longest := strings.Repeat("好", 2048)
	for _, details := range []string{
		fmt.Sprintf(`{"selector":%q,"autoSource":"whole-page"}`, longest),
		fmt.Sprintf(`{"selector":"main\t>\n div\r\f.a","autoSource":"article","autoSelector":%q}`, longest),
		`{"selector":"#c","autoSource":"none"}`,
	} {
		e.wantRecorded(e.submit("u1", articleChoice("https://x.com/a", details)), true)
	}

	selectors := map[string]bool{}
	for _, r := range rows(t, "u1") {
		var d struct{ Selector string }
		if err := json.Unmarshal([]byte(r.Details), &d); err != nil {
			t.Fatal(err)
		}
		selectors[d.Selector] = true
	}
	if len(selectors) != 3 || !selectors[longest] || !selectors["main\t>\n div\r\f.a"] || !selectors["#c"] {
		t.Fatalf("selectors = %v, want each kept exactly", selectors)
	}
}

func TestSubmitRejectsInvalidArticleChoices(t *testing.T) {
	e := newEnv(t)
	tooLong := strings.Repeat("a", 2049)
	for name, body := range map[string]string{
		"with text":                     `{"kind":"article_choice","url":"https://x.com/a","text":"hi","details":{"selector":"main","autoSource":"none"}}`,
		"no url":                        articleChoice("", choiceOf("main")),
		"url not http":                  articleChoice("chrome://extensions", choiceOf("main")),
		"no details":                    `{"kind":"article_choice","url":"https://x.com/a"}`,
		"no selector":                   articleChoice("https://x.com/a", `{"autoSource":"none"}`),
		"empty selector":                articleChoice("https://x.com/a", choiceOf("")),
		"selector not a string":         articleChoice("https://x.com/a", `{"selector":1,"autoSource":"none"}`),
		"selector over 2048":            articleChoice("https://x.com/a", choiceOf(tooLong)),
		"selector with a control char":  articleChoice("https://x.com/a", `{"selector":"main\u0001","autoSource":"none"}`),
		"selector with DEL":             articleChoice("https://x.com/a", `{"selector":"main\u007f","autoSource":"none"}`),
		"selector with vertical tab":    articleChoice("https://x.com/a", `{"selector":"main\u000bdiv","autoSource":"none"}`),
		"no auto source":                articleChoice("https://x.com/a", `{"selector":"main"}`),
		"unknown auto source":           articleChoice("https://x.com/a", `{"selector":"main","autoSource":"guess"}`),
		"whole page with auto selector": articleChoice("https://x.com/a", `{"selector":"main","autoSource":"whole-page","autoSelector":"body"}`),
		"none with auto platform":       articleChoice("https://x.com/a", `{"selector":"main","autoSource":"none","autoPlatform":"x"}`),
		"platform without selector":     articleChoice("https://x.com/a", `{"selector":"main","autoSource":"article","autoPlatform":"x"}`),
		"empty auto selector":           articleChoice("https://x.com/a", `{"selector":"main","autoSource":"article","autoSelector":""}`),
		"auto selector over 2048":       articleChoice("https://x.com/a", fmt.Sprintf(`{"selector":"main","autoSource":"article","autoSelector":%q}`, tooLong)),
		"auto selector control char":    articleChoice("https://x.com/a", `{"selector":"main","autoSource":"article","autoSelector":"a\u0000"}`),
		"empty auto platform":           articleChoice("https://x.com/a", `{"selector":"main","autoSource":"article","autoSelector":"a","autoPlatform":""}`),
		"bad auto platform":             articleChoice("https://x.com/a", `{"selector":"main","autoSource":"article","autoSelector":"a","autoPlatform":"A B"}`),
		"bad adapter":                   `{"kind":"article_choice","url":"https://x.com/a","context":{"adapter":"A B"},"details":{"selector":"main","autoSource":"none"}}`,
		"bad version":                   `{"kind":"article_choice","url":"https://x.com/a","context":{"extVersion":"1 0"},"details":{"selector":"main","autoSource":"none"}}`,
	} {
		w := e.submit("u1", body)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d body=%s, want 400", name, w.Code, w.Body.String())
		}
	}
	if n := len(rows(t, "u1")); n != 0 {
		t.Fatalf("rows = %d, want none", n)
	}
}

func TestSubmitKeepsOneArticleChoicePerUserHostAndSelectorEvenAtTheLimit(t *testing.T) {
	e := newEnv(t)
	seed(t, "u1", "text", today.Add(-time.Hour), 48)

	e.wantRecorded(e.submit("u1", articleChoice("https://x.com/a", choiceOf("main"))), true)
	// Another page and detection result on the same host: the same candidate.
	e.now = today.Add(48 * time.Hour)
	e.wantRecorded(e.submit("u1", articleChoice("https://X.com/b", `{"selector":"main","autoSource":"whole-page"}`)), false)
	e.now = today
	e.wantRecorded(e.submit("u1", articleChoice("https://y.com/a", choiceOf("main"))), true)
	// At the limit now; a repeat is still answered as done.
	e.wantRecorded(e.submit("u1", articleChoice("https://x.com/c", choiceOf("main"))), false)
	// One byte apart is another selector, so it counts and is refused.
	if w := e.submit("u1", articleChoice("https://x.com/a", choiceOf("main "))); w.Code != http.StatusTooManyRequests {
		t.Fatalf("other selector at the limit: status %d body=%s, want 429", w.Code, w.Body.String())
	}
	e.wantRecorded(e.submit("u2", articleChoice("https://x.com/a", choiceOf("main"))), true)

	if n := len(rows(t, "u1")); n != 50 {
		t.Fatalf("rows = %d, want 50", n)
	}
}

func TestSubmitStoresOneArticleChoiceUnderConcurrentDuplicates(t *testing.T) {
	e := newEnvWith(t, slowStore{})

	codes := make([]int, 8)
	var wg sync.WaitGroup
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes[i] = e.submit("u1", articleChoice(fmt.Sprintf("https://x.com/page-%d", i), choiceOf("main"))).Code
		}(i)
	}
	wg.Wait()

	for _, c := range codes {
		if c != http.StatusOK {
			t.Fatalf("status %d, want 200 for every duplicate", c)
		}
	}
	if n := len(rows(t, "u1")); n != 1 {
		t.Fatalf("rows = %d, want 1", n)
	}
}

type groupsResponse struct {
	Success bool `json:"success"`
	Groups  []struct {
		Host      string `json:"host"`
		Selector  string `json:"selector"`
		Count     int    `json:"count"`
		Total     int    `json:"total"`
		SampleURL string `json:"sampleUrl"`
	} `json:"groups"`
	NextOffset *int `json:"nextOffset"`
}

func (e *env) groups(query string) groupsResponse {
	e.t.Helper()
	w := e.do(http.MethodGet, "/api/admin/feedback/article-choices"+query, "admin", "")
	if w.Code != http.StatusOK {
		e.t.Fatalf("GET groups%s: status %d body=%s", query, w.Code, w.Body.String())
	}
	return decode[groupsResponse](e.t, w)
}

// choose submits user's choice of selector on url one minute after the
// previous submission, so the newest record is well defined.
func (e *env) choose(user, url, selector string) {
	e.t.Helper()
	e.now = e.now.Add(time.Minute)
	e.wantRecorded(e.submit(user, articleChoice(url, choiceOf(selector))), true)
}

func TestArticleChoiceGroupsCountRecordsAcrossListPages(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < 150; i++ {
		e.choose(fmt.Sprintf("u%d", i), fmt.Sprintf("https://x.com/p/%d", i), "main")
	}
	e.choose("u1", "https://y.com/a", "article")
	e.choose("u2", "https://y.com/b", "article")
	e.choose("u1", "https://x.com/c", "#content")
	e.choose("u3", "https://y.com/c", "article")
	seed(t, "u1", "page_report", today, 3)

	if records := e.list("?kind=article_choice"); len(records.Feedback) != 100 || records.NextOffset == nil {
		t.Fatalf("records: %d, nextOffset %v, want them paged", len(records.Feedback), records.NextOffset)
	}

	first := e.groups("?limit=2")
	if !first.Success || len(first.Groups) != 2 || first.NextOffset == nil || *first.NextOffset != 2 {
		t.Fatalf("first page = %+v", first)
	}
	if g := first.Groups[0]; g.Host != "x.com" || g.Selector != "main" || g.Count != 150 || g.Total != 150 || g.SampleURL != "https://x.com/p/149" {
		t.Fatalf("largest group = %+v", g)
	}
	if g := first.Groups[1]; g.Host != "y.com" || g.Selector != "article" || g.Count != 3 || g.SampleURL != "https://y.com/c" {
		t.Fatalf("second group = %+v", g)
	}
	second := e.groups("?limit=2&offset=2")
	if len(second.Groups) != 1 || second.NextOffset != nil || second.Groups[0].Selector != "#content" || second.Groups[0].Count != 1 {
		t.Fatalf("second page = %+v", second)
	}
}

func TestArticleChoiceGroupsFilterRecordsByStatusBeforeGrouping(t *testing.T) {
	e := newEnv(t)
	e.choose("u1", "https://x.com/a", "main")
	e.choose("u2", "https://x.com/b", "main")
	e.choose("u3", "https://x.com/c", "main")
	e.choose("u1", "https://y.com/a", "main")
	resolveRecordOf(t, e, "u3", "x.com")
	resolveRecordOf(t, e, "u1", "y.com")

	newOnly := e.groups("?status=new")
	if len(newOnly.Groups) != 1 {
		t.Fatalf("new groups = %+v, want only x.com", newOnly)
	}
	if g := newOnly.Groups[0]; g.Host != "x.com" || g.Count != 2 || g.Total != 3 || g.SampleURL != "https://x.com/b" {
		t.Fatalf("new x.com group = %+v", g)
	}
	resolved := e.groups("?status=resolved")
	if len(resolved.Groups) != 2 || resolved.Groups[0].Host != "x.com" || resolved.Groups[0].Count != 1 ||
		resolved.Groups[0].SampleURL != "https://x.com/c" || resolved.Groups[1].Host != "y.com" {
		t.Fatalf("resolved groups = %+v", resolved)
	}
	all := e.groups("")
	if len(all.Groups) != 2 || all.Groups[0].Count != 3 || all.Groups[0].SampleURL != "https://x.com/c" {
		t.Fatalf("all groups = %+v", all)
	}
}

func resolveRecordOf(t *testing.T, e *env, user, host string) {
	t.Helper()
	for _, r := range rows(t, user) {
		if r.Host == host {
			if w := e.do(http.MethodPatch, "/api/admin/feedback/"+r.ID, "admin", `{"status":"resolved"}`); w.Code != http.StatusOK {
				t.Fatalf("resolve %s: %d", r.ID, w.Code)
			}
			return
		}
	}
	t.Fatalf("no record of %s on %s", user, host)
}

func TestResolvingAnArticleChoiceGroupResolvesEveryRecordInIt(t *testing.T) {
	e := newEnv(t)
	e.choose("u1", "https://x.com/a", "main")
	e.choose("u2", "https://x.com/b", "main")
	e.choose("u3", "https://x.com/c", "main")
	e.choose("u1", "https://x.com/d", "main ")
	resolveRecordOf(t, e, "u2", "x.com")

	w := e.do(http.MethodPost, "/api/admin/feedback/article-choices/resolve", "admin", `{"host":"x.com","selector":"main"}`)
	if w.Code != http.StatusOK || w.Body.String() != `{"resolved":3,"success":true}` {
		t.Fatalf("resolve group: status %d body=%s", w.Code, w.Body.String())
	}

	var all []sqlitex.Feedback
	if err := sqlitex.DB.Order("url").Find(&all).Error; err != nil {
		t.Fatal(err)
	}
	for _, r := range all {
		want := "resolved"
		if r.URL == "https://x.com/d" {
			want = "new"
		}
		if r.Status != want {
			t.Errorf("%s: status %s, want %s", r.URL, r.Status, want)
		}
	}
	if records := e.list("?kind=article_choice&status=resolved"); len(records.Feedback) != 3 {
		t.Fatalf("resolved records = %d, want each still listed", len(records.Feedback))
	}

	if w := e.do(http.MethodPost, "/api/admin/feedback/article-choices/resolve", "admin", `{"host":"z.com","selector":"main"}`); w.Code != http.StatusNotFound {
		t.Errorf("unknown group: status %d, want 404", w.Code)
	}
	for _, body := range []string{`{"host":"x.com"}`, `{"selector":"main"}`, `nope`} {
		if w := e.do(http.MethodPost, "/api/admin/feedback/article-choices/resolve", "admin", body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", body, w.Code)
		}
	}
}

func TestArticleChoiceGroupsRejectInvalidFiltersAndPaging(t *testing.T) {
	e := newEnv(t)
	for _, q := range []string{"?status=open", "?limit=0", "?limit=201", "?limit=ten", "?offset=-1"} {
		if w := e.do(http.MethodGet, "/api/admin/feedback/article-choices"+q, "admin", ""); w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", q, w.Code)
		}
	}
}
