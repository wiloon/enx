package server

import (
	"net/http"
	"testing"

	"enx-api/utils/sqlitex"
)

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
	// A reviewed AI row is visible to every user, with or without AI access.
	for name, token := range map[string]string{"AI user": credited, "user without AI": adminToken} {
		code, body := doJSON(t, http.MethodGet, base+"/api/word/rizzler", token)
		if code != http.StatusOK || body["Chinese"] != "n. 很有魅力的人" || body["Origin"] != "ai" || body["Id"] == "" {
			t.Fatalf("%s after approve: code=%d body=%+v, want the word with an id", name, code, body)
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
