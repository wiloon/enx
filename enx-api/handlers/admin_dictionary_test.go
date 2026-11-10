package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"enx-api/ecdict"
	"enx-api/ecdict/ecdicttest"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
)

func callWithWord(h gin.HandlerFunc, word string) int {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	c.Params = gin.Params{{Key: "word", Value: word}}
	h(c)
	return w.Code
}

func TestAdminHandlersRejectBlankWord(t *testing.T) {
	for name, h := range map[string]gin.HandlerFunc{
		"AdminGetWord":            AdminGetWord,
		"AdminGetEcdict":          AdminGetEcdict,
		"AdminSyncWordFromEcdict": AdminSyncWordFromEcdict,
		"AdminDeleteWord":         AdminDeleteWord,
	} {
		if code := callWithWord(h, "  "); code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, code)
		}
	}
}

func TestAdminEcdictHandlersNeedEcdict(t *testing.T) {
	ecdict.Init("")
	for name, h := range map[string]gin.HandlerFunc{
		"AdminGetEcdict":          AdminGetEcdict,
		"AdminSyncWordFromEcdict": AdminSyncWordFromEcdict,
	} {
		if code := callWithWord(h, "hello"); code != http.StatusServiceUnavailable {
			t.Errorf("%s: status %d, want 503", name, code)
		}
	}
}

// adminDictionary mounts the admin dictionary handlers on a fresh app
// database and an ECDICT holding "hello" and "run" (with "running" as an
// inflection).
func adminDictionary(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	sqlitex.Init(filepath.Join(t.TempDir(), "enx-admin-dict.db"))
	ecdict.Init(ecdicttest.Create(t,
		ecdicttest.Row{Word: "hello", Sw: "hello", Phonetic: "/həˈloʊ/", Translation: "int. 你好；喂"},
		ecdicttest.Row{Word: "run", Sw: "run", Phonetic: "/rʌn/", Translation: "v. 跑；奔跑\nn. 奔跑", Exchange: "i:running/d:ran"},
	))
	t.Cleanup(func() { ecdict.Init("") })

	r := gin.New()
	r.GET("/words/:word", AdminGetWord)
	r.PUT("/words/:word", AdminEditWord)
	r.POST("/words/:word/sync-from-ecdict", AdminSyncWordFromEcdict)
	r.GET("/ecdict/:word", AdminGetEcdict)
	r.GET("/ai-words", AdminListAIWords)
	return r
}

// serve sends method path with body (nil for none) and decodes the JSON reply.
func serve(t *testing.T, r *gin.Engine, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var req *http.Request
	if body == nil {
		req = httptest.NewRequest(method, path, nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req = httptest.NewRequest(method, path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("%s %s: decode %s: %v", method, path, w.Body.String(), err)
	}
	return w.Code, out
}

func seedAIWord(t *testing.T, id, english string, users map[string]int) {
	t.Helper()
	chinese, quality, version := "n. "+english, 8, "v1"
	if err := sqlitex.DB.Create(&sqlitex.Word{
		Id: id, English: english, Chinese: &chinese, Source: "ai",
		AIQuality: &quality, AIPromptVersion: &version, CreatedAt: 1, UpdatedAt: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	for user, lookups := range users {
		if err := sqlitex.DB.Create(&sqlitex.UserDict{UserId: user, WordId: id, QueryCount: lookups, CreatedAt: 1, UpdatedAt: 1}).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func TestAdminGetWordAnswersFoundFalseForAnAbsentWord(t *testing.T) {
	r := adminDictionary(t)

	code, body := serve(t, r, http.MethodGet, "/words/hello", nil)

	if code != http.StatusOK || len(body) != 1 || body["found"] != false {
		t.Fatalf("GET absent word = %d %v, want 200 {found:false}", code, body)
	}
}

func TestAdminGetWordShowsTheRowWithItsUsage(t *testing.T) {
	r := adminDictionary(t)
	seedAIWord(t, "w-rizzler", "rizzler", map[string]int{"u1": 2, "u2": 3})

	code, body := serve(t, r, http.MethodGet, "/words/rizzler", nil)

	if code != http.StatusOK || body["found"] != true || body["id"] != "w-rizzler" || body["chinese"] != "n. rizzler" ||
		body["source"] != "ai" || body["aiQuality"] != float64(8) || body["aiPromptVersion"] != "v1" ||
		body["users"] != float64(2) || body["lookups"] != float64(5) {
		t.Fatalf("GET word = %d %v, want the row, its provenance and its usage", code, body)
	}
}

func TestAdminGetEcdictShowsTheRawRowAndHowItMatched(t *testing.T) {
	r := adminDictionary(t)

	code, body := serve(t, r, http.MethodGet, "/ecdict/hello", nil)
	if code != http.StatusOK || body["found"] != true || body["matchedBy"] != "exact" || body["word"] != "hello" ||
		body["sw"] != "hello" || body["phonetic"] != "/həˈloʊ/" || body["translation"] != "int. 你好；喂" {
		t.Fatalf("GET ecdict/hello = %d %v, want the exact row", code, body)
	}
	code, body = serve(t, r, http.MethodGet, "/ecdict/running", nil)
	if code != http.StatusOK || body["matchedBy"] != "exchange" || body["word"] != "run" || body["exchange"] != "i:running/d:ran" {
		t.Fatalf("GET ecdict/running = %d %v, want run via exchange", code, body)
	}
	code, body = serve(t, r, http.MethodGet, "/ecdict/serendipity", nil)
	if code != http.StatusOK || len(body) != 1 || body["found"] != false {
		t.Fatalf("GET ecdict/serendipity = %d %v, want 200 {found:false}", code, body)
	}
}

func TestAdminSyncFromEcdictAnswersWithTheWrittenRow(t *testing.T) {
	r := adminDictionary(t)

	code, body := serve(t, r, http.MethodPost, "/words/running/sync-from-ecdict", nil)

	word, _ := body["word"].(map[string]any)
	if code != http.StatusOK || body["success"] != true || body["matchedBy"] != "exchange" ||
		word["found"] != true || word["english"] != "running" || word["chinese"] != "v. 跑；奔跑\nn. 奔跑" || word["pronunciation"] != "/rʌn/" {
		t.Fatalf("sync = %d %v, want the words row written from run", code, body)
	}
}

func TestAdminSyncOfAWordECDICTLacksIsAConflictAndWritesNothing(t *testing.T) {
	r := adminDictionary(t)

	code, body := serve(t, r, http.MethodPost, "/words/serendipity/sync-from-ecdict", nil)

	if code != http.StatusConflict || body["success"] != false {
		t.Fatalf("sync = %d %v, want 409", code, body)
	}
	var rows int64
	sqlitex.DB.Model(&sqlitex.Word{}).Where("english = ?", "serendipity").Count(&rows)
	if rows != 0 {
		t.Fatalf("%d words rows written for a word ECDICT lacks", rows)
	}
}

func TestAdminEditWordTrimsTheTextAndAnswersWithTheEditedRow(t *testing.T) {
	r := adminDictionary(t)
	if code, _ := serve(t, r, http.MethodPost, "/words/hello/sync-from-ecdict", nil); code != http.StatusOK {
		t.Fatalf("sync: %d", code)
	}

	code, body := serve(t, r, http.MethodPut, "/words/hello", map[string]string{"chinese": "  int. 你好，喂  ", "pronunciation": " /həˈləʊ/ "})

	word, _ := body["word"].(map[string]any)
	if code != http.StatusOK || body["success"] != true || word["chinese"] != "int. 你好，喂" || word["pronunciation"] != "/həˈləʊ/" ||
		word["source"] != "ecdict" || word["adminEditedAt"] == nil {
		t.Fatalf("edit = %d %v, want trimmed text, the source kept and the edit recorded", code, body)
	}
}

func TestAdminEditWordOfAnAbsentWordIsNotFound(t *testing.T) {
	r := adminDictionary(t)

	if code, body := serve(t, r, http.MethodPut, "/words/hello", map[string]string{"chinese": "x"}); code != http.StatusNotFound || body["success"] != false {
		t.Fatalf("edit = %d %v, want 404", code, body)
	}
}

func TestAdminEditWordRejectsAnEmptyOrOversizedEdit(t *testing.T) {
	r := adminDictionary(t)
	if code, _ := serve(t, r, http.MethodPost, "/words/hello/sync-from-ecdict", nil); code != http.StatusOK {
		t.Fatalf("sync: %d", code)
	}

	for name, payload := range map[string]any{
		"no body":                nil,
		"blank chinese":          map[string]string{"chinese": "   "},
		"missing chinese":        map[string]string{"pronunciation": "/x/"},
		"chinese over 4000":      map[string]string{"chinese": strings.Repeat("长", 4001)},
		"pronunciation over 100": map[string]string{"chinese": "x", "pronunciation": strings.Repeat("a", 101)},
	} {
		if code, body := serve(t, r, http.MethodPut, "/words/hello", payload); code != http.StatusBadRequest || body["success"] != false {
			t.Errorf("%s: %d %v, want 400", name, code, body)
		}
	}
	if code, _ := serve(t, r, http.MethodPut, "/words/hello", map[string]string{"chinese": strings.Repeat("长", 4000), "pronunciation": strings.Repeat("a", 100)}); code != http.StatusOK {
		t.Errorf("an edit at both limits: %d, want 200", code)
	}
}

func TestAdminListAIWordsAnswersEachRowWithItsUsageAndTheTotal(t *testing.T) {
	r := adminDictionary(t)
	seedAIWord(t, "w-a", "queuea", map[string]int{"u1": 1})
	seedAIWord(t, "w-b", "queueb", map[string]int{"u1": 2, "u2": 3})

	code, body := serve(t, r, http.MethodGet, "/ai-words?limit=1", nil)

	words, _ := body["words"].([]any)
	if code != http.StatusOK || body["total"] != float64(2) || len(words) != 1 {
		t.Fatalf("list = %d %v, want one row of 2", code, body)
	}
	first := words[0].(map[string]any)
	if first["english"] != "queueb" || first["users"] != float64(2) || first["lookups"] != float64(5) ||
		first["source"] != "ai" || first["aiQuality"] != float64(8) || first["aiPromptVersion"] != "v1" {
		t.Fatalf("first row = %v, want queueb with its usage and provenance", first)
	}
}

func TestAdminListAIWordsRejectsBadPaging(t *testing.T) {
	r := adminDictionary(t)

	for _, q := range []string{"limit=0", "limit=201", "limit=abc", "offset=-1", "offset=x"} {
		if code, body := serve(t, r, http.MethodGet, "/ai-words?"+q, nil); code != http.StatusBadRequest || body["success"] != false {
			t.Errorf("?%s: %d %v, want 400", q, code, body)
		}
	}
	if code, _ := serve(t, r, http.MethodGet, "/ai-words?limit=200&offset=0", nil); code != http.StatusOK {
		t.Errorf("?limit=200&offset=0: %d, want 200", code)
	}
}
