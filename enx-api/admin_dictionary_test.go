package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"enx-api/clerktest"
	"enx-api/config"
	"enx-api/ecdict"
	"enx-api/ecdict/ecdicttest"
	"enx-api/utils"
	"enx-api/utils/sqlitex"

	"github.com/golang-jwt/jwt/v5"
	"github.com/spf13/viper"
)

const (
	adminSub    = "user_admin_dict_e2e"
	nonAdminSub = "user_plain_dict_e2e"
)

// adminDictEnv wires a full test server with Clerk, a fresh app DB, an ECDICT
// database seeded with a couple of rows, and adminSub in the admin allowlist.
func adminDictEnv(t *testing.T) (baseURL string, adminToken, plainToken string) {
	t.Helper()
	return adminDictEnvWithConfig(t, noTrialConfig())
}

// noTrialConfig is the default config without the sign-up trial (ADR-048):
// most of these tests rely on a new user having no credit. Tests of the trial
// turn it back on.
func noTrialConfig() *config.Config {
	cfg := config.Default()
	cfg.Credits.Trial.Amount = 0
	return cfg
}

// adminDictEnvWithConfig is adminDictEnv on the given config.
func adminDictEnvWithConfig(t *testing.T, cfg *config.Config) (baseURL string, adminToken, plainToken string) {
	t.Helper()

	env := clerktest.NewEnv(t)
	utils.ViperInit()
	env.ApplyViper()

	// viper.Set outranks the bound ADMIN_CLERK_USER_IDS env var.
	viper.Set("admin.clerk-user-ids", []string{adminSub})
	t.Cleanup(func() { viper.Set("admin.clerk-user-ids", nil) })

	dbPath := filepath.Join(t.TempDir(), "enx-admin-dict.db")
	if err := os.Setenv("DB_PATH", dbPath); err != nil {
		t.Fatalf("set DB_PATH: %v", err)
	}
	sqlitex.Init()
	if sqlitex.DB == nil {
		t.Fatal("sqlitex.DB is nil after Init")
	}
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM users WHERE clerk_user_id IN (?, ?)", adminSub, nonAdminSub)
		sqlitex.DB.Exec("DELETE FROM words WHERE english IN (?, ?, ?)", "hello", "running", "serendipity")
	})

	seedEcdict(t)

	ts, done := e2eServer(t, cfg)
	t.Cleanup(done)

	adminToken = env.SignSessionToken(t, jwt.MapClaims{"sub": adminSub, "email": "admin@example.com", "name": "admin"})
	plainToken = env.SignSessionToken(t, jwt.MapClaims{"sub": nonAdminSub, "email": "plain@example.com", "name": "plain"})
	return ts.URL, adminToken, plainToken
}

func seedEcdict(t *testing.T) {
	t.Helper()
	ecdict.Init(ecdicttest.Create(t,
		ecdicttest.Row{Word: "hello", Sw: "hello", Phonetic: "/həˈloʊ/", Translation: "int. 你好；喂"},
		ecdicttest.Row{Word: "run", Sw: "run", Phonetic: "/rʌn/", Translation: "v. 跑；奔跑\nn. 奔跑", Exchange: "i:running/d:ran"},
	))
	if !ecdict.IsAvailable() {
		t.Fatal("ECDICT not available after Init")
	}
	t.Cleanup(func() { ecdict.Init("") })
}

func doJSON(t *testing.T, method, url, token string) (int, map[string]any) {
	t.Helper()
	return doJSONBody(t, method, url, token, nil)
}

// doJSONBody is doJSON with a JSON request body (nil sends none).
func doJSONBody(t *testing.T, method, url, token string, payload any) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("encode body: %v", err)
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer resp.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	return resp.StatusCode, body
}

func TestE2E_AdminDictionary_RequiresAdmin(t *testing.T) {
	base, adminToken, plainToken := adminDictEnv(t)

	endpoints := []struct{ method, path string }{
		{http.MethodGet, "/api/admin/words/hello"},
		{http.MethodGet, "/api/admin/ecdict/hello"},
		{http.MethodPost, "/api/admin/words/hello/sync-from-ecdict"},
		{http.MethodPut, "/api/admin/words/hello"},
		{http.MethodGet, "/api/admin/ai-words"},
		{http.MethodDelete, "/api/admin/words/hello"},
	}
	for _, ep := range endpoints {
		if code, _ := doJSON(t, ep.method, base+ep.path, plainToken); code != http.StatusForbidden {
			t.Errorf("%s %s as non-admin: status = %d, want 403", ep.method, ep.path, code)
		}
		if code, _ := doJSON(t, ep.method, base+ep.path, ""); code != http.StatusUnauthorized {
			t.Errorf("%s %s unauthenticated: status = %d, want 401", ep.method, ep.path, code)
		}
	}
	// Admin passes the gate (200 for the reads).
	if code, _ := doJSON(t, http.MethodGet, base+"/api/admin/ecdict/hello", adminToken); code != http.StatusOK {
		t.Errorf("admin GET ecdict: status = %d, want 200", code)
	}
}

func TestE2E_AdminDictionary_ReadsBothSourcesRaw(t *testing.T) {
	base, adminToken, _ := adminDictEnv(t)

	// words: nothing there yet.
	code, body := doJSON(t, http.MethodGet, base+"/api/admin/words/hello", adminToken)
	if code != http.StatusOK || body["found"] != false {
		t.Fatalf("words (absent): code=%d body=%+v", code, body)
	}

	// ecdict: exact match, raw row incl. sw/exchange + matchedBy.
	code, body = doJSON(t, http.MethodGet, base+"/api/admin/ecdict/hello", adminToken)
	if code != http.StatusOK || body["found"] != true || body["matchedBy"] != "exact" ||
		body["translation"] != "int. 你好；喂" || body["sw"] != "hello" {
		t.Fatalf("ecdict (exact): code=%d body=%+v", code, body)
	}

	// ecdict: inflected form reachable only via the exchange fallback.
	code, body = doJSON(t, http.MethodGet, base+"/api/admin/ecdict/running", adminToken)
	if code != http.StatusOK || body["found"] != true || body["matchedBy"] != "exchange" || body["word"] != "run" {
		t.Fatalf("ecdict (exchange): code=%d body=%+v", code, body)
	}
}

func TestE2E_AdminDictionary_SyncFromEcdict(t *testing.T) {
	base, adminToken, _ := adminDictEnv(t)

	// First sync creates the words row from ECDICT.
	code, body := doJSON(t, http.MethodPost, base+"/api/admin/words/hello/sync-from-ecdict", adminToken)
	if code != http.StatusOK || body["success"] != true {
		t.Fatalf("sync create: code=%d body=%+v", code, body)
	}
	word, _ := body["word"].(map[string]any)
	if word["found"] != true || word["chinese"] != "int. 你好；喂" || word["pronunciation"] != "/həˈloʊ/" {
		t.Fatalf("synced word = %+v", word)
	}

	// Now GET /api/admin/words reflects it.
	code, body = doJSON(t, http.MethodGet, base+"/api/admin/words/hello", adminToken)
	if code != http.StatusOK || body["found"] != true || body["chinese"] != "int. 你好；喂" {
		t.Fatalf("words after sync: code=%d body=%+v", code, body)
	}

	// Idempotent second sync.
	if code, _ := doJSON(t, http.MethodPost, base+"/api/admin/words/hello/sync-from-ecdict", adminToken); code != http.StatusOK {
		t.Fatalf("second sync: code=%d", code)
	}

	// A word absent from ECDICT -> 409, no write.
	code, _ = doJSON(t, http.MethodPost, base+"/api/admin/words/serendipity/sync-from-ecdict", adminToken)
	if code != http.StatusConflict {
		t.Fatalf("sync of ECDICT-absent word: code=%d, want 409", code)
	}
	if code, body := doJSON(t, http.MethodGet, base+"/api/admin/words/serendipity", adminToken); code != http.StatusOK || body["found"] != false {
		t.Fatalf("serendipity should not have been written: code=%d body=%+v", code, body)
	}
}

// ADR-045 Decision 6: an admin's edit is recorded, keeps the row's source, and
// is what releases an AI-made row to users who can't use AI.
func TestE2E_AdminDictionary_EditWord(t *testing.T) {
	base, adminToken, _ := adminDictEnv(t)
	url := base + "/api/admin/words/hello"

	// Only an existing row can be edited.
	if code, _ := doJSONBody(t, http.MethodPut, url, adminToken, map[string]string{"chinese": "x"}); code != http.StatusNotFound {
		t.Fatalf("edit of an absent word: code=%d, want 404", code)
	}
	if code, _ := doJSON(t, http.MethodPost, base+"/api/admin/words/hello/sync-from-ecdict", adminToken); code != http.StatusOK {
		t.Fatalf("sync: code=%d", code)
	}

	code, body := doJSONBody(t, http.MethodPut, url, adminToken, map[string]string{"chinese": "  int. 你好，喂  ", "pronunciation": "/həˈləʊ/"})
	if code != http.StatusOK || body["success"] != true {
		t.Fatalf("edit: code=%d body=%+v", code, body)
	}
	word, _ := body["word"].(map[string]any)
	if word["chinese"] != "int. 你好，喂" || word["pronunciation"] != "/həˈləʊ/" || word["source"] != "ecdict" || word["adminEditedAt"] == nil {
		t.Fatalf("edited word = %+v, want trimmed text, source kept as ecdict, and the edit recorded", word)
	}

	code, body = doJSON(t, http.MethodGet, url, adminToken)
	if code != http.StatusOK || body["chinese"] != "int. 你好，喂" || body["adminEditedAt"] == nil {
		t.Fatalf("words after edit: code=%d body=%+v", code, body)
	}

	for name, payload := range map[string]map[string]string{
		"empty chinese":     {"chinese": "   "},
		"missing chinese":   {"pronunciation": "/x/"},
		"too long chinese":  {"chinese": strings.Repeat("长", 4001)},
		"too long phonetic": {"chinese": "x", "pronunciation": strings.Repeat("a", 101)},
	} {
		if code, _ := doJSONBody(t, http.MethodPut, url, adminToken, payload); code != http.StatusBadRequest {
			t.Errorf("%s: code=%d, want 400", name, code)
		}
	}
	if code, _ := doJSONBody(t, http.MethodPut, url, adminToken, nil); code != http.StatusBadRequest {
		t.Errorf("no body: code=%d, want 400", code)
	}
}

// ADR-045 Decision 6 end to end: an AI-made definition in the words table is
// shown to a user who can use AI, hidden from one who can't, and shown to
// everyone once an admin has edited it. The admin account stands in for the
// user without AI: it has no subscription and no credit.
func TestE2E_Lookup_AIDefinitionVisibility(t *testing.T) {
	base, adminToken, plainToken := adminDictEnv(t)
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM words WHERE english = ?", "rizzler")
		sqlitex.DB.Exec("DELETE FROM credit_accounts WHERE user_id IN (SELECT id FROM users WHERE clerk_user_id = ?)", nonAdminSub)
	})

	// The plain user exists once it has made a request; give it credit.
	if code, _ := doJSON(t, http.MethodGet, base+"/api/me", plainToken); code != http.StatusOK {
		t.Fatalf("GET /api/me: code=%d", code)
	}
	var plainID string
	if err := sqlitex.DB.Raw("SELECT id FROM users WHERE clerk_user_id = ?", nonAdminSub).Scan(&plainID).Error; err != nil || plainID == "" {
		t.Fatalf("plain user id = %q, %v", plainID, err)
	}
	if err := sqlitex.DB.Create(&sqlitex.CreditAccount{UserId: plainID, TopupBalance: 25, UpdatedAt: 1}).Error; err != nil {
		t.Fatal(err)
	}

	// An AI-made row (not in ECDICT), as the AI fallback will leave it.
	chinese := "n. 很有魅力的人"
	if err := sqlitex.DB.Create(&sqlitex.Word{
		Id: "w-ai-rizzler", English: "rizzler", Chinese: &chinese, CreatedAt: 1, UpdatedAt: 1, Source: "ai",
	}).Error; err != nil {
		t.Fatal(err)
	}
	lookup := func(token string) map[string]any {
		t.Helper()
		code, body := doJSON(t, http.MethodGet, base+"/api/word/rizzler", token)
		if code != http.StatusOK {
			t.Fatalf("lookup: code=%d body=%+v", code, body)
		}
		return body
	}

	if got := lookup(plainToken); got["Chinese"] != chinese || got["Origin"] != "ai" {
		t.Fatalf("a user with credit should see the AI definition with its origin, got %+v", got)
	}
	if got := lookup(adminToken); got["Chinese"] != "" {
		t.Fatalf("a user who can't use AI must not see an unedited AI definition, got %+v", got)
	}

	if code, _ := doJSONBody(t, http.MethodPut, base+"/api/admin/words/rizzler", adminToken, map[string]string{"chinese": "n. 魅力十足的人"}); code != http.StatusOK {
		t.Fatalf("admin edit: code=%d", code)
	}
	if got := lookup(adminToken); got["Chinese"] != "n. 魅力十足的人" || got["Origin"] != "ai" {
		t.Fatalf("after an admin edit everyone should see it, got %+v", got)
	}
}

// ADR-045: the review queue lists AI-made definitions busiest first, an edit
// takes a word out of it, and the word detail carries real usage.
func TestE2E_AdminDictionary_AIReviewQueue(t *testing.T) {
	base, adminToken, _ := adminDictEnv(t)
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM words WHERE english IN ('queuea', 'queueb', 'queuec')")
		sqlitex.DB.Exec("DELETE FROM user_dicts WHERE word_id LIKE 'w-queue%'")
	})
	quality, version := 8, "v1"
	for i, name := range []string{"queuea", "queueb", "queuec"} {
		chinese := "n. " + name
		if err := sqlitex.DB.Create(&sqlitex.Word{
			Id: "w-" + name, English: name, Chinese: &chinese, Source: "ai",
			AIQuality: &quality, AIPromptVersion: &version, CreatedAt: int64(i + 1), UpdatedAt: int64(i + 1),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// queueb is the busiest: two users, five lookups.
	for _, ud := range []sqlitex.UserDict{
		{UserId: "x1", WordId: "w-queueb", QueryCount: 2, CreatedAt: 1, UpdatedAt: 1},
		{UserId: "x2", WordId: "w-queueb", QueryCount: 3, CreatedAt: 1, UpdatedAt: 1},
		{UserId: "x1", WordId: "w-queuea", QueryCount: 1, CreatedAt: 1, UpdatedAt: 1},
	} {
		if err := sqlitex.DB.Create(&ud).Error; err != nil {
			t.Fatal(err)
		}
	}

	names := func(body map[string]any) []string {
		var out []string
		list, _ := body["words"].([]any)
		for _, item := range list {
			out = append(out, item.(map[string]any)["english"].(string))
		}
		return out
	}

	code, body := doJSON(t, http.MethodGet, base+"/api/admin/ai-words", adminToken)
	if code != http.StatusOK || body["total"] != float64(3) {
		t.Fatalf("queue: code=%d body=%+v", code, body)
	}
	if got := names(body); len(got) != 3 || got[0] != "queueb" || got[1] != "queuea" || got[2] != "queuec" {
		t.Fatalf("queue order = %v, want queueb (2 users), queuea (1), queuec (0)", got)
	}
	first := body["words"].([]any)[0].(map[string]any)
	if first["users"] != float64(2) || first["lookups"] != float64(5) || first["aiQuality"] != float64(8) || first["aiPromptVersion"] != "v1" || first["source"] != "ai" {
		t.Fatalf("first row = %+v, want its usage and provenance", first)
	}

	// Approving (an edit, even with the text unchanged) takes it out of the queue.
	if code, _ := doJSONBody(t, http.MethodPut, base+"/api/admin/words/queueb", adminToken, map[string]string{"chinese": "n. queueb"}); code != http.StatusOK {
		t.Fatalf("approve: code=%d", code)
	}
	_, body = doJSON(t, http.MethodGet, base+"/api/admin/ai-words", adminToken)
	if got := names(body); len(got) != 2 || body["total"] != float64(2) {
		t.Fatalf("queue after approving = %v (total %v), want 2 left", got, body["total"])
	}
	_, body = doJSON(t, http.MethodGet, base+"/api/admin/ai-words?reviewed=true", adminToken)
	if got := names(body); len(got) != 1 || got[0] != "queueb" {
		t.Fatalf("reviewed = %v, want [queueb]", got)
	}

	// The word detail shows the same real usage; loadCount is not a signal.
	_, detail := doJSON(t, http.MethodGet, base+"/api/admin/words/queueb", adminToken)
	if detail["users"] != float64(2) || detail["lookups"] != float64(5) || detail["source"] != "ai" || detail["adminEditedAt"] == nil {
		t.Fatalf("detail = %+v", detail)
	}

	// Paging and bad parameters.
	_, body = doJSON(t, http.MethodGet, base+"/api/admin/ai-words?limit=1&offset=1", adminToken)
	if got := names(body); len(got) != 1 || body["total"] != float64(2) {
		t.Fatalf("page = %v (total %v), want 1 row of 2", got, body["total"])
	}
	for _, q := range []string{"limit=0", "limit=201", "limit=abc", "offset=-1", "offset=x"} {
		if code, _ := doJSON(t, http.MethodGet, base+"/api/admin/ai-words?"+q, adminToken); code != http.StatusBadRequest {
			t.Errorf("?%s: code=%d, want 400", q, code)
		}
	}
}

// Deleting a words row drops every user's review row for it too, so only an
// admin may do it (it used to be DELETE /api/word/:word, open to any user).
func TestE2E_AdminDictionary_DeleteWord(t *testing.T) {
	base, adminToken, plainToken := adminDictEnv(t)

	if err := sqlitex.DB.Create(&sqlitex.Word{Id: "w-hello", English: "hello", CreatedAt: 1, UpdatedAt: 1}).Error; err != nil {
		t.Fatal(err)
	}
	for _, user := range []string{"u-a", "u-b"} {
		if err := sqlitex.DB.Create(&sqlitex.UserDict{UserId: user, WordId: "w-hello", QueryCount: 3, CreatedAt: 1, UpdatedAt: 1}).Error; err != nil {
			t.Fatal(err)
		}
	}

	if code, _ := doJSON(t, http.MethodDelete, base+"/api/word/hello", plainToken); code != http.StatusNotFound {
		t.Fatalf("old DELETE /api/word/hello as a user: status = %d, want 404 (route removed)", code)
	}

	if code, body := doJSON(t, http.MethodDelete, base+"/api/admin/words/hello", adminToken); code != http.StatusOK || body["success"] != true {
		t.Fatalf("admin delete: code=%d body=%+v", code, body)
	}
	var words, reviews int64
	sqlitex.DB.Model(&sqlitex.Word{}).Where("english = ?", "hello").Count(&words)
	sqlitex.DB.Model(&sqlitex.UserDict{}).Where("word_id = ?", "w-hello").Count(&reviews)
	if words != 0 || reviews != 0 {
		t.Fatalf("after delete: %d words rows, %d user_dicts rows; want 0 and 0", words, reviews)
	}
}
