package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"enx-api/clerktest"
	"enx-api/ecdict"
	"enx-api/utils"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"github.com/golang-jwt/jwt/v5"
	"github.com/spf13/viper"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

const (
	adminSub    = "user_admin_dict_e2e"
	nonAdminSub = "user_plain_dict_e2e"
)

// adminDictEnv wires a full test server with Clerk, a fresh app DB, an ECDICT
// database seeded with a couple of rows, and adminSub in the admin allowlist.
func adminDictEnv(t *testing.T) (baseURL string, adminToken, plainToken string) {
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

	ts, done := e2eServer(t)
	t.Cleanup(done)

	adminToken = env.SignSessionToken(t, jwt.MapClaims{"sub": adminSub, "email": "admin@example.com", "name": "admin"})
	plainToken = env.SignSessionToken(t, jwt.MapClaims{"sub": nonAdminSub, "email": "plain@example.com", "name": "plain"})
	return ts.URL, adminToken, plainToken
}

func seedEcdict(t *testing.T) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "ecdict-admin-e2e.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE stardict (word TEXT PRIMARY KEY, sw TEXT, phonetic TEXT, translation TEXT, exchange TEXT)`).Error; err != nil {
		t.Fatal(err)
	}
	rows := [][]any{
		{"hello", "hello", "/həˈloʊ/", "int. 你好；喂", ""},
		{"run", "run", "/rʌn/", "v. 跑；奔跑\nn. 奔跑", "i:running/d:ran"},
	}
	for _, r := range rows {
		if err := db.Exec(`INSERT INTO stardict (word, sw, phonetic, translation, exchange) VALUES (?, ?, ?, ?, ?)`, r...).Error; err != nil {
			t.Fatal(err)
		}
	}
	ecdict.Init(dbPath)
	if !ecdict.IsAvailable() {
		t.Fatal("ECDICT not available after Init")
	}
	t.Cleanup(func() { ecdict.Init("") })
}

func doJSON(t *testing.T, method, url, token string) (int, map[string]any) {
	t.Helper()
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
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
