package handlers

import (
	"fmt"
	"net/http"
	"sync"
	"testing"

	"enx-api/utils/sqlitex"
)

func reviewStateOf(t *testing.T, userID, wordID string) (sqlitex.ReviewState, bool) {
	t.Helper()
	var rows []sqlitex.ReviewState
	if err := sqlitex.DB.Where("user_id = ? AND word_id = ?", userID, wordID).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		return sqlitex.ReviewState{}, false
	}
	return rows[0], true
}

// reviewLogsOf lists userID's log rows for wordID, oldest first, each as
// "type/source/rescheduled".
func reviewLogsOf(t *testing.T, userID, wordID string) []string {
	t.Helper()
	var rows []sqlitex.ReviewLog
	if err := sqlitex.DB.Where("user_id = ? AND word_id = ?", userID, wordID).Order("id").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	out := []string{}
	for _, r := range rows {
		rescheduled := "-"
		if r.Rescheduled != nil {
			rescheduled = fmt.Sprint(*r.Rescheduled)
		}
		out = append(out, r.Type+"/"+r.Source+"/"+rescheduled)
	}
	return out
}

func wantLogs(t *testing.T, userID, wordID string, want ...string) {
	t.Helper()
	if got := reviewLogsOf(t, userID, wordID); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("review_logs %v, want %v", got, want)
	}
}

func TestWordLookupCreatesAReviewStateAndLogsIt(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")

	recordLookupOf(t, "u1", id)

	state, found := reviewStateOf(t, "u1", id)
	if !found || state.Reps != 1 || state.Lapses != 0 || state.Due <= state.LastReview {
		t.Fatalf("review state %+v (found %v), want one review, no lapse, due later", state, found)
	}
	wantLogs(t, "u1", id, "lookup/unknown/true")
}

func TestWordLookupRepeatedAtOnceCountsButDoesNotReschedule(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")
	recordLookupOf(t, "u1", id)
	first, _ := reviewStateOf(t, "u1", id)

	resp := recordLookupOf(t, "u1", id)

	if resp.QueryCount != 2 {
		t.Fatalf("queryCount %d, want 2", resp.QueryCount)
	}
	if again, _ := reviewStateOf(t, "u1", id); again.Due != first.Due || again.Reps != first.Reps || again.LastReview != first.LastReview {
		t.Fatalf("state %+v, want %+v unchanged", again, first)
	}
	wantLogs(t, "u1", id, "lookup/unknown/true", "lookup/unknown/false")
}

func TestWordLookupSourceIsRecordedAndNeverFailsTheRequest(t *testing.T) {
	// The subtest name is part of the seeded word id, so it carries no quotes.
	for name, tc := range map[string]struct{ source, want string }{
		"popover":    {`"popover"`, "popover"},
		"word_list":  {`"word_list"`, "word_list"},
		"review":     {`"review"`, "unknown"},
		"other":      {`"nonsense"`, "unknown"},
		"not_string": {`7`, "unknown"},
		"null":       {`null`, "unknown"},
	} {
		t.Run(name, func(t *testing.T) {
			setupKnownTest(t)
			id := seedKnownWord(t, "serendipity")
			want := tc.want

			code, _ := postWordLookup(t, "u1", `{"wordId":"`+id+`","source":`+tc.source+`}`)

			if code != http.StatusOK {
				t.Fatalf("got %d, want 200", code)
			}
			wantLogs(t, "u1", id, "lookup/"+want+"/true")
		})
	}
}

// ADR-097 Decision 4: the count, the old known flag, the state and the log row
// are one transaction.
func TestWordLookupThatCannotLogLeavesNothingBehind(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")
	seedReview(t, "u1", id, 3, true)
	if err := sqlitex.DB.Migrator().DropTable(&sqlitex.ReviewLog{}); err != nil {
		t.Fatal(err)
	}

	code, _ := postWordLookup(t, "u1", `{"wordId":"`+id+`"}`)

	if code != http.StatusInternalServerError {
		t.Fatalf("got %d, want 500", code)
	}
	if qc, known, _ := reviewOf(t, "u1", id); qc != 3 || !known {
		t.Fatalf("user_dicts %d/%v, want 3/true unchanged", qc, known)
	}
	if state, found := reviewStateOf(t, "u1", id); found {
		t.Fatalf("review state %+v, want none", state)
	}
	if got := lookupOutcomes(t, "u1"); len(got) != 0 {
		t.Fatalf("lookup events %v, want none", got)
	}
	if u := quotaUsage(t, "u1"); u.Used != 1 {
		t.Fatalf("quota used %d, want the charge to stand", u.Used)
	}
}

func TestConcurrentLookupsOfAKnownWordRecordOneLapseAndBothCounts(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")
	seedReview(t, "u1", id, 3, true)

	var wg sync.WaitGroup
	codes := make([]int, 2)
	for i := range codes {
		wg.Go(func() {
			codes[i] = sendWordLookup(t, defaultLookupQuota, "u1", `{"wordId":"`+id+`"}`).Code
		})
	}
	wg.Wait()

	if codes[0] != http.StatusOK || codes[1] != http.StatusOK {
		t.Fatalf("statuses %v, want both 200", codes)
	}
	if qc, known, _ := reviewOf(t, "u1", id); qc != 5 || known {
		t.Fatalf("user_dicts %d/%v, want 5/false", qc, known)
	}
	if state, _ := reviewStateOf(t, "u1", id); state.Lapses != 1 || state.LastLapseAt == nil || state.Reps != 1 {
		t.Fatalf("state %+v, want one lapse and one review", state)
	}
	wantLogs(t, "u1", id, "lookup_lapse/unknown/true", "lookup/unknown/false")
}

func TestKnownAndUnknowLogOnlyActualChanges(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")
	recordLookupOf(t, "u1", id)
	before, _ := reviewStateOf(t, "u1", id)

	for _, step := range []struct{ method, query string }{
		{http.MethodDelete, ""}, // not known yet: no change
		{http.MethodPut, "?source=popover"},
		{http.MethodPut, "?source=popover"}, // retry
		{http.MethodDelete, "?source=elsewhere"},
		{http.MethodDelete, ""}, // retry
		{http.MethodPut, ""},
	} {
		if code := knownRequestWithQuery(t, step.method, "u1", "serendipity", step.query); code != http.StatusOK {
			t.Fatalf("%s %s: got %d, want 200", step.method, step.query, code)
		}
	}

	wantLogs(t, "u1", id, "lookup/unknown/true", "know/popover/-", "unknow/unknown/-", "know/unknown/-")
	if after, _ := reviewStateOf(t, "u1", id); after.Due != before.Due || after.Reps != before.Reps {
		t.Fatalf("state %+v, want %+v untouched by known", after, before)
	}
}

// A word marked known without ever being looked up gets a log row but no
// review state.
func TestKnownOnAWordNeverLookedUpLogsButCreatesNoState(t *testing.T) {
	setupKnownTest(t)
	id := seedKnownWord(t, "serendipity")

	knownRequestWithQuery(t, http.MethodDelete, "u1", "serendipity", "")
	knownRequestWithQuery(t, http.MethodPut, "u1", "serendipity", "?source=word_list")
	knownRequestWithQuery(t, http.MethodPut, "u1", "zzqxnotaword", "")

	wantLogs(t, "u1", id, "know/word_list/-")
	var logs, states int64
	sqlitex.DB.Model(&sqlitex.ReviewLog{}).Count(&logs)
	sqlitex.DB.Model(&sqlitex.ReviewState{}).Count(&states)
	if logs != 1 || states != 0 {
		t.Fatalf("%d logs, %d states; want 1 and 0", logs, states)
	}
}
