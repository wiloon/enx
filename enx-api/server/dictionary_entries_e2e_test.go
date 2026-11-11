package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"enx-api/utils/sqlitex"
)

type entryResultBody struct {
	Word       string
	Status     string
	Id         *string
	English    string
	Chinese    string
	Origin     string
	AIFallback *struct{ CanUse, Auto bool }
}

// sendEntries sends body to the batch definitions route with method and
// returns the status, the Accept-Query header and the decoded results.
func sendEntries(t *testing.T, method, url, token, body string) (int, string, []entryResultBody) {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	var results []entryResultBody
	if resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
			t.Fatalf("%s %s: decode: %v", method, url, err)
		}
	}
	return resp.StatusCode, resp.Header.Get("Accept-Query"), results
}

func userIDOf(t *testing.T, clerkUserID string) string {
	t.Helper()
	var id string
	if err := sqlitex.DB.Raw("SELECT id FROM users WHERE clerk_user_id = ?", clerkUserID).Scan(&id).Error; err != nil || id == "" {
		t.Fatalf("user %s: %q %v", clerkUserID, id, err)
	}
	return id
}

func countLookupEvents(t *testing.T, userID string) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Table("lookup_events").Where("user_id = ?", userID).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

// quotaUsed is userID's dictionary_quota_usage.used summed over every day.
func quotaUsed(t *testing.T, userID string) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Raw("SELECT COALESCE(SUM(used), 0) FROM dictionary_quota_usage WHERE user_id = ?", userID).Scan(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

// ADR-079 Decision 1: QUERY /api/dictionary/entries and its POST fallback are
// one handler: same validation, same results, same charge.
func TestE2E_DictionaryEntriesOverQueryAndPostFallback(t *testing.T) {
	base, _, token := adminDictEnv(t)

	charged := int64(0)
	for _, route := range []struct{ method, path string }{
		{"QUERY", "/api/dictionary/entries"},
		{http.MethodPost, "/api/dictionary/entries/query"},
	} {
		code, acceptQuery, results := sendEntries(t, route.method, base+route.path, token,
			`{"words":["running","hello","zzxqv","hello"]}`)
		if code != http.StatusOK || acceptQuery != "application/json" {
			t.Fatalf("%s %s: status %d, Accept-Query %q; want 200 and application/json", route.method, route.path, code, acceptQuery)
		}
		if len(results) != 3 {
			t.Fatalf("%s: %d results %+v, want 3 (hello once)", route.method, len(results), results)
		}
		running, hello, miss := results[0], results[1], results[2]
		if running.Word != "running" || running.Status != "found" || running.English != "run" || running.Id == nil || *running.Id == "" {
			t.Errorf("%s: running = %+v, want found under its own key with headword run and an id", route.method, running)
		}
		if hello.Word != "hello" || hello.Status != "found" || !strings.Contains(hello.Chinese, "你好") || hello.Origin != "ecdict" {
			t.Errorf("%s: hello = %+v, want found with its ECDICT definition", route.method, hello)
		}
		if miss.Word != "zzxqv" || miss.Status != "not_found" || miss.AIFallback == nil || miss.Id != nil {
			t.Errorf("%s: zzxqv = %+v, want not_found with an AIFallback and no id", route.method, miss)
		}

		userID := userIDOf(t, nonAdminSub)
		charged += 3
		if got := quotaUsed(t, userID); got != charged {
			t.Errorf("%s: quota used %d, want %d (one per distinct word)", route.method, got, charged)
		}
		if n := countLookupEvents(t, userID); n != 0 {
			t.Errorf("%s: %d lookup events, want none", route.method, n)
		}
	}

	for _, method := range []string{"QUERY", http.MethodPost} {
		path := "/api/dictionary/entries"
		if method == http.MethodPost {
			path += "/query"
		}
		if code, _, _ := sendEntries(t, method, base+path, token, `{"words":["good morning"]}`); code != http.StatusBadRequest {
			t.Errorf("%s: a sentence got %d, want 400", method, code)
		}
	}
}

// ADR-079 Decision 7: the old lookup GETs charge one and write no lookup
// event; POST /api/me/word-lookups charges one and writes the event.
func TestE2E_OldLookupGETsChargeAndOnlyThePOSTWritesAnEvent(t *testing.T) {
	base, _, token := adminDictEnv(t)

	for _, path := range []string{"/api/translate?word=hello", "/api/word/hello"} {
		if code, body := doJSON(t, http.MethodGet, base+path, token); code != http.StatusOK || body["Id"] == "" {
			t.Fatalf("GET %s: %d %v", path, code, body)
		}
	}
	userID := userIDOf(t, nonAdminSub)
	if used, events := quotaUsed(t, userID), countLookupEvents(t, userID); used != 2 || events != 0 {
		t.Fatalf("after two GETs: quota used %d, %d lookup events; want 2 and 0", used, events)
	}

	_, body := doJSON(t, http.MethodGet, base+"/api/word/hello", token)
	code, resp := doJSONBody(t, http.MethodPost, base+"/api/me/word-lookups", token, map[string]any{"wordId": body["Id"]})
	if code != http.StatusOK || resp["queryCount"] != float64(1) {
		t.Fatalf("POST word-lookups: %d %v", code, resp)
	}
	if used, events := quotaUsed(t, userID), countLookupEvents(t, userID); used != 4 || events != 1 {
		t.Fatalf("after the POST: quota used %d, %d lookup events; want 4 and 1", used, events)
	}
}
