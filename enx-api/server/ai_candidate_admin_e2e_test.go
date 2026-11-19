package server

import (
	"net/http"
	"testing"

	"enx-api/dictionary"
	"enx-api/utils/sqlitex"
)

func persistedRizzler(t *testing.T) sqlitex.Word {
	t.Helper()
	var word sqlitex.Word
	if err := sqlitex.DB.Where("english = ? AND deleted_at IS NULL", "rizzler").First(&word).Error; err != nil {
		t.Fatal(err)
	}
	if word.Id == "" {
		t.Fatal("persisted word has no ID")
	}
	return word
}

// ADR-091 admin review end to end: the candidate a user's low-quality ask
// created is listed, rejected, un-rejected and approved through the admin API,
// and the word's answer follows each step.
func TestE2E_AICandidateAdminReview(t *testing.T) {
	base, credited, adminToken, _, model := aiWordEnv(t, lowQualityReply)
	t.Cleanup(func() {
		if err := sqlitex.DB.Exec("DELETE FROM ai_candidates").Error; err != nil {
			t.Error(err)
		}
	})
	ask := func() (int, map[string]any) {
		return doJSONBody(t, http.MethodPost, base+"/api/dictionary/ai-word", credited, map[string]string{"word": "rizzler"})
	}
	list := func(status string) map[string]any {
		t.Helper()
		code, body := doJSON(t, http.MethodGet, base+"/api/admin/ai-candidates?status="+status, adminToken)
		if code != http.StatusOK {
			t.Fatalf("list %s: code = %d body = %+v", status, code, body)
		}
		return body
	}
	post := func(action string) (int, map[string]any) {
		return doJSON(t, http.MethodPost, base+"/api/admin/ai-candidates/rizzler/"+action, adminToken)
	}

	if code, body := ask(); code != http.StatusOK || body["found"] != true {
		t.Fatalf("first ask: code=%d body=%+v", code, body)
	}
	if code, _ := ask(); code != http.StatusOK {
		t.Fatalf("second ask: code=%d", code)
	}
	pending := list("pending")
	rows, _ := pending["candidates"].([]any)
	if pending["total"] != float64(1) || len(rows) != 1 {
		t.Fatalf("pending list = %+v, want one candidate", pending)
	}
	row, _ := rows[0].(map[string]any)
	if row["english"] != "rizzler" || row["chinese"] != "n. 很有魅力的人" || row["quality"] != float64(5) ||
		row["hitCount"] != float64(2) || row["status"] != "pending" {
		t.Fatalf("candidate row = %+v", row)
	}

	if code, body := post("reject"); code != http.StatusOK {
		t.Fatalf("reject: code=%d body=%+v", code, body)
	}
	if got := list("pending")["total"]; got != float64(0) {
		t.Fatalf("pending total after reject = %v, want 0", got)
	}
	if got := list("rejected")["total"]; got != float64(1) {
		t.Fatalf("rejected total = %v, want 1", got)
	}
	if code, body := ask(); code != http.StatusOK || body["found"] != false || body["reason"] != "no_definition" {
		t.Fatalf("ask after reject: code=%d body=%+v, want no_definition", code, body)
	}

	if code, body := post("unreject"); code != http.StatusOK {
		t.Fatalf("unreject: code=%d body=%+v", code, body)
	}
	if code, body := ask(); code != http.StatusOK || body["found"] != true {
		t.Fatalf("ask after unreject: code=%d body=%+v", code, body)
	}

	code, body := post("approve")
	if code != http.StatusOK || body["created"] != true {
		t.Fatalf("approve: code=%d body=%+v, want created true", code, body)
	}
	persisted := persistedRizzler(t)
	// A reviewed AI row is visible to every user, with or without AI access.
	for name, token := range map[string]string{"AI user": credited, "user without AI": adminToken} {
		code, body := doJSON(t, http.MethodGet, base+"/api/word/rizzler", token)
		id, _ := body["Id"].(string)
		if code != http.StatusOK || body["Chinese"] != "n. 很有魅力的人" || body["Origin"] != "ai" || id != persisted.Id {
			t.Fatalf("%s after approve: code=%d body=%+v, want the word with persisted ID %q", name, code, body, persisted.Id)
		}
	}
	if got := model.calls.Load(); got != 1 {
		t.Fatalf("provider calls = %d, want 1 for the whole review", got)
	}
	if code, _ := post("approve"); code != http.StatusNotFound {
		t.Fatalf("approve again: code = %d, want 404", code)
	}
	if code, _ := post("reject"); code != http.StatusNotFound {
		t.Fatalf("reject after approve: code = %d, want 404", code)
	}
}

func TestE2E_AICandidateAdminListDefaultsToPendingAndPages(t *testing.T) {
	base, adminToken, _ := adminDictEnv(t)
	rows := []sqlitex.AICandidate{
		{English: "alpha", Status: string(dictionary.CandidatePending), HitCount: 3},
		{English: "beta", Status: string(dictionary.CandidatePending), HitCount: 2},
		{English: "gamma", Status: string(dictionary.CandidatePending), HitCount: 1},
		{English: "delta", Status: string(dictionary.CandidateRejected), HitCount: 4},
	}
	if err := sqlitex.DB.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}

	code, body := doJSON(t, http.MethodGet, base+"/api/admin/ai-candidates?limit=1&offset=1", adminToken)
	page, _ := body["candidates"].([]any)
	if code != http.StatusOK || body["total"] != float64(3) || len(page) != 1 {
		t.Fatalf("list: code=%d body=%+v, want one row out of three pending candidates", code, body)
	}
	row, _ := page[0].(map[string]any)
	if row["english"] != "beta" || row["status"] != "pending" {
		t.Fatalf("page row = %+v, want pending candidate beta", row)
	}
}

func TestE2E_AICandidateAdminListRejectsInvalidQueryParameters(t *testing.T) {
	base, adminToken, _ := adminDictEnv(t)
	for _, tc := range []struct{ query, message string }{
		{"status=approved", "status must be pending or rejected"},
		{"limit=abc", "limit must be between 1 and 200"},
		{"limit=0", "limit must be between 1 and 200"},
		{"limit=201", "limit must be between 1 and 200"},
		{"offset=abc", "offset must be 0 or more"},
		{"offset=-1", "offset must be 0 or more"},
	} {
		t.Run(tc.query, func(t *testing.T) {
			code, body := doJSON(t, http.MethodGet, base+"/api/admin/ai-candidates?"+tc.query, adminToken)
			if code != http.StatusBadRequest || body["success"] != false || body["message"] != tc.message {
				t.Fatalf("list: code=%d body=%+v, want 400 with message %q", code, body, tc.message)
			}
		})
	}
}

func TestE2E_AICandidateAdminApproveReportsWriteFailure(t *testing.T) {
	base, adminToken, _ := adminDictEnv(t)
	row := sqlitex.AICandidate{English: "rizzler", Status: string(dictionary.CandidatePending)}
	if err := sqlitex.DB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec(`CREATE TRIGGER fail_word_insert AFTER INSERT ON words
		BEGIN SELECT RAISE(FAIL, 'approval write failed'); END`).Error; err != nil {
		t.Fatal(err)
	}
	code, body := doJSON(t, http.MethodPost, base+"/api/admin/ai-candidates/rizzler/approve", adminToken)
	if code != http.StatusInternalServerError || body["success"] != false || body["message"] != "failed to update the AI candidate definition" {
		t.Fatalf("approve: code=%d body=%+v, want the approval failure response", code, body)
	}
}

func TestE2E_AICandidateAdminEndpointsRequireAdmin(t *testing.T) {
	base, _, plainToken := adminDictEnv(t)
	endpoints := []struct{ method, path string }{
		{http.MethodGet, "/api/admin/ai-candidates"},
		{http.MethodPost, "/api/admin/ai-candidates/hello/approve"},
		{http.MethodPost, "/api/admin/ai-candidates/hello/reject"},
		{http.MethodPost, "/api/admin/ai-candidates/hello/unreject"},
	}
	for _, ep := range endpoints {
		if code, _ := doJSON(t, ep.method, base+ep.path, plainToken); code != http.StatusForbidden {
			t.Errorf("%s %s as non-admin: status = %d, want 403", ep.method, ep.path, code)
		}
	}
}
