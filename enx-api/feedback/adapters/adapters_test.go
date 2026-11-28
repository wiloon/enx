package adapters

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"enx-api/feedback"
	"enx-api/utils/sqlitex"
	"enx-api/utils/sqlitex/sqlitextest"

	"gorm.io/gorm"
)

var base = time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC)

// open is the table under test and the handle of the database it works on.
func open(t *testing.T) (Table, *gorm.DB) {
	t.Helper()
	db := sqlitextest.Open(t)
	return Table{}, db
}

// choice is an article choice by u1 of "main" on x.com, to be varied per test.
func choice(id string, at time.Time, vary ...func(*feedback.Record)) feedback.Record {
	r := feedback.Record{
		ID: id, UserID: "u1", Kind: feedback.KindArticleChoice,
		URL: "https://x.com/" + id, Host: "x.com",
		Context: []byte(`{"adapter":"x"}`), Details: []byte(`{"selector":"main"}`),
		Status: feedback.StatusNew, CreatedAt: at,
	}
	for _, v := range vary {
		v(&r)
	}
	return r
}

func byUser(user string) func(*feedback.Record) {
	return func(r *feedback.Record) { r.UserID = user }
}

func ofKind(kind feedback.Kind, details string) func(*feedback.Record) {
	return func(r *feedback.Record) { r.Kind, r.Details = kind, []byte(details) }
}

func chose(host, selector string) func(*feedback.Record) {
	return func(r *feedback.Record) {
		r.Host, r.Details = host, []byte(`{"selector":"`+selector+`"}`)
	}
}

func resolved(r *feedback.Record) { r.Status = feedback.StatusResolved }

func insert(t *testing.T, tbl Table, records ...feedback.Record) {
	t.Helper()
	err := tbl.Admit(context.Background(), func(a feedback.Admission) error {
		for _, r := range records {
			if err := a.Insert(r); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func stored(t *testing.T, db *gorm.DB) []sqlitex.Feedback {
	t.Helper()
	var rows []sqlitex.Feedback
	if err := db.Order("id").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

// statuses is every stored row's status by id.
func statuses(t *testing.T, db *gorm.DB) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, r := range stored(t, db) {
		out[r.ID] = r.Status
	}
	return out
}

func listIDs(t *testing.T, tbl Table, q feedback.ListQuery) []string {
	t.Helper()
	records, err := tbl.List(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, r := range records {
		ids = append(ids, r.ID)
	}
	return ids
}

func TestAdmitStoresARecordInsertedInsideTheCallback(t *testing.T) {
	tbl, db := open(t)
	insert(t, tbl, choice("a", base))

	want := []sqlitex.Feedback{{
		ID: "a", UserID: "u1", Kind: "article_choice", URL: "https://x.com/a", Host: "x.com",
		Context: `{"adapter":"x"}`, Details: `{"selector":"main"}`, Status: "new", CreatedAt: base.UnixMilli(),
	}}
	if got := stored(t, db); !reflect.DeepEqual(got, want) {
		t.Fatalf("rows = %+v, want %+v", got, want)
	}
}

func TestAdmitStoresNothingWhenTheCallbackReturnsAnError(t *testing.T) {
	tbl, db := open(t)
	refused := errors.New("refused")

	err := tbl.Admit(context.Background(), func(a feedback.Admission) error {
		if err := a.Insert(choice("a", base)); err != nil {
			return err
		}
		return refused
	})

	if !errors.Is(err, refused) {
		t.Fatalf("err = %v, want the callback's", err)
	}
	if got := stored(t, db); len(got) != 0 {
		t.Fatalf("rows = %+v, want none", got)
	}
}

// admitted runs check in a transaction of its own, after the records are stored.
func admitted(t *testing.T, check func(feedback.Admission), records ...feedback.Record) {
	t.Helper()
	tbl, _ := open(t)
	insert(t, tbl, records...)
	err := tbl.Admit(context.Background(), func(a feedback.Admission) error {
		check(a)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestAdmissionHasPageReportSinceMatchesTheUsersLaterReports(t *testing.T) {
	url := "https://x.com/a"
	report := choice("a", base, ofKind(feedback.KindPageReport, `{"reason":"error"}`))
	admitted(t, func(a feedback.Admission) {
		for name, c := range map[string]struct {
			user, url, reason string
			since             time.Time
			want              bool
		}{
			"created after since": {"u1", url, "error", base.Add(-time.Millisecond), true},
			"created at since":    {"u1", url, "error", base, false},
			"another user":        {"u2", url, "error", base.Add(-time.Hour), false},
			"another url":         {"u1", url + "/b", "error", base.Add(-time.Hour), false},
			"another reason":      {"u1", url, "no-words", base.Add(-time.Hour), false},
		} {
			got, err := a.HasPageReportSince(c.user, c.url, c.reason, c.since)
			if err != nil || got != c.want {
				t.Errorf("%s: %v, %v, want %v", name, got, err, c.want)
			}
		}
	}, report)
}

func TestAdmissionHasArticleChoiceMatchesTheUsersHostAndSelector(t *testing.T) {
	admitted(t, func(a feedback.Admission) {
		for name, c := range map[string]struct {
			user, host, selector string
			want                 bool
		}{
			"stored":           {"u1", "x.com", "main", true},
			"another user":     {"u2", "x.com", "main", false},
			"another host":     {"u1", "y.com", "main", false},
			"another selector": {"u1", "x.com", "main ", false},
		} {
			got, err := a.HasArticleChoice(c.user, c.host, c.selector)
			if err != nil || got != c.want {
				t.Errorf("%s: %v, %v, want %v", name, got, err, c.want)
			}
		}
	}, choice("a", base))
}

func TestAdmissionCountCreatedCountsTheUsersRecordsFromUpToButNotTo(t *testing.T) {
	from, to := base, base.Add(time.Hour)
	admitted(t, func(a feedback.Admission) {
		got, err := a.CountCreated("u1", from, to)
		if err != nil || got != 2 {
			t.Fatalf("CountCreated = %d, %v, want 2", got, err)
		}
	},
		choice("before", from.Add(-time.Millisecond)),
		choice("at-from", from),
		choice("last", to.Add(-time.Millisecond)),
		choice("at-to", to),
		choice("theirs", from, byUser("u2")),
	)
}

func TestListReturnsTheStoredRecord(t *testing.T) {
	tbl, _ := open(t)
	want := choice("a", base, func(r *feedback.Record) { r.Text = "hello" })
	insert(t, tbl, want)

	got, err := tbl.List(context.Background(), feedback.ListQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !got[0].CreatedAt.Equal(base) {
		t.Fatalf("records = %+v", got)
	}
	got[0].CreatedAt = want.CreatedAt
	if !reflect.DeepEqual(got[0], want) {
		t.Fatalf("record = %+v, want %+v", got[0], want)
	}
}

func TestListFiltersByKindAndStatus(t *testing.T) {
	tbl, _ := open(t)
	insert(t, tbl,
		choice("choice-new", base.Add(3*time.Second)),
		choice("choice-resolved", base.Add(2*time.Second), resolved),
		choice("text-new", base.Add(time.Second), ofKind(feedback.KindText, `{}`)),
		choice("text-resolved", base, ofKind(feedback.KindText, `{}`), resolved),
	)

	for name, c := range map[string]struct {
		q    feedback.ListQuery
		want []string
	}{
		"empty matches all": {feedback.ListQuery{},
			[]string{"choice-new", "choice-resolved", "text-new", "text-resolved"}},
		"kind":   {feedback.ListQuery{Kind: feedback.KindText}, []string{"text-new", "text-resolved"}},
		"status": {feedback.ListQuery{Status: feedback.StatusResolved}, []string{"choice-resolved", "text-resolved"}},
		"both":   {feedback.ListQuery{Kind: feedback.KindText, Status: feedback.StatusNew}, []string{"text-new"}},
	} {
		c.q.Limit = 10
		if got := listIDs(t, tbl, c.q); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: %v, want %v", name, got, c.want)
		}
	}
}

func TestListIsNewestFirstWithTiesByIDDescendingAndPaged(t *testing.T) {
	tbl, _ := open(t)
	insert(t, tbl,
		choice("b", base),
		choice("a", base.Add(time.Second)),
		choice("c", base),
		choice("d", base.Add(-time.Second)),
	)

	if got, want := listIDs(t, tbl, feedback.ListQuery{Limit: 10}), []string{"a", "c", "b", "d"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}
	if got, want := listIDs(t, tbl, feedback.ListQuery{Limit: 2, Offset: 1}), []string{"c", "b"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("page = %v, want %v", got, want)
	}
}

func TestListReadsAnEmptyContextAndDetailsAsEmptyObjects(t *testing.T) {
	tbl, db := open(t)
	insert(t, tbl, choice("a", base))
	// Insert already writes {}, so empty the columns directly.
	if err := db.Exec("UPDATE feedback SET context = '', details = ''").Error; err != nil {
		t.Fatal(err)
	}

	got, err := tbl.List(context.Background(), feedback.ListQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || string(got[0].Context) != "{}" || string(got[0].Details) != "{}" {
		t.Fatalf("records = %+v, want context and details {}", got)
	}
}

func TestSetStatusChangesAKnownRecordAndReportsAnUnknownID(t *testing.T) {
	tbl, db := open(t)
	insert(t, tbl, choice("a", base), choice("b", base))

	found, err := tbl.SetStatus(context.Background(), "a", feedback.StatusResolved)
	if err != nil || !found {
		t.Fatalf("known id: %v, %v, want true", found, err)
	}
	found, err = tbl.SetStatus(context.Background(), "missing", feedback.StatusResolved)
	if err != nil || found {
		t.Fatalf("unknown id: %v, %v, want false", found, err)
	}
	if got, want := statuses(t, db), map[string]string{"a": "resolved", "b": "new"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("statuses = %v, want %v", got, want)
	}
}

func groups(t *testing.T, tbl Table, q feedback.GroupQuery) []feedback.ArticleChoiceGroup {
	t.Helper()
	got, err := tbl.ArticleChoiceGroups(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestArticleChoiceGroupsCountTheQueriedStatusAndSampleItsNewestRecord(t *testing.T) {
	tbl, _ := open(t)
	insert(t, tbl,
		choice("a", base),
		choice("c", base.Add(time.Second)),
		choice("b", base.Add(time.Second)),
		choice("d", base.Add(2*time.Second), resolved),
		// Another kind with the same host and selector is no part of the group.
		choice("e", base.Add(3*time.Second), ofKind(feedback.KindText, `{"selector":"main"}`)),
	)

	for status, want := range map[feedback.Status]feedback.ArticleChoiceGroup{
		"":                      {Host: "x.com", Selector: "main", Count: 4, Total: 4, SampleURL: "https://x.com/d"},
		feedback.StatusNew:      {Host: "x.com", Selector: "main", Count: 3, Total: 4, SampleURL: "https://x.com/c"},
		feedback.StatusResolved: {Host: "x.com", Selector: "main", Count: 1, Total: 4, SampleURL: "https://x.com/d"},
	} {
		got := groups(t, tbl, feedback.GroupQuery{Status: status, Limit: 10})
		if !reflect.DeepEqual(got, []feedback.ArticleChoiceGroup{want}) {
			t.Errorf("status %q: %+v, want %+v", status, got, want)
		}
	}
}

func TestArticleChoiceGroupsAreOrderedByCountThenHostThenSelectorAndPaged(t *testing.T) {
	tbl, _ := open(t)
	insert(t, tbl,
		choice("1", base, chose("b.com", "main")),
		choice("2", base, chose("a.com", "main")),
		choice("3", base, chose("a.com", "article")),
		choice("4", base, chose("c.com", "main")),
		choice("5", base, chose("c.com", "main")),
	)
	keys := func(q feedback.GroupQuery) []string {
		out := []string{}
		for _, g := range groups(t, tbl, q) {
			out = append(out, g.Host+" "+g.Selector)
		}
		return out
	}

	want := []string{"c.com main", "a.com article", "a.com main", "b.com main"}
	if got := keys(feedback.GroupQuery{Limit: 10}); !reflect.DeepEqual(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}
	if got := keys(feedback.GroupQuery{Limit: 2, Offset: 1}); !reflect.DeepEqual(got, want[1:3]) {
		t.Fatalf("page = %v, want %v", got, want[1:3])
	}
}

func TestSetArticleChoiceGroupStatusChangesEveryRecordOfThatGroupOnly(t *testing.T) {
	tbl, db := open(t)
	insert(t, tbl,
		choice("a", base),
		choice("b", base, byUser("u2"), resolved),
		choice("other-host", base, chose("y.com", "main")),
		choice("other-selector", base, chose("x.com", "article")),
		choice("other-kind", base, ofKind(feedback.KindText, `{"selector":"main"}`)),
	)

	n, err := tbl.SetArticleChoiceGroupStatus(context.Background(), "x.com", "main", feedback.StatusResolved)
	if err != nil || n != 2 {
		t.Fatalf("changed = %d, %v, want 2", n, err)
	}
	want := map[string]string{"a": "resolved", "b": "resolved",
		"other-host": "new", "other-selector": "new", "other-kind": "new"}
	if got := statuses(t, db); !reflect.DeepEqual(got, want) {
		t.Fatalf("statuses = %v, want %v", got, want)
	}
}
