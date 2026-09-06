package translate

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRespondSentenceUnavailable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	respondSentenceUnavailable(c, "hello world")

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", w.Code)
	}

	var word struct {
		English string `json:"English"`
		Chinese string `json:"Chinese"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &word); err != nil {
		t.Fatal(err)
	}
	if word.English != "hello world" {
		t.Fatalf("english: %q", word.English)
	}
	if word.Chinese != SentenceTranslationNotice {
		t.Fatalf("chinese: %q", word.Chinese)
	}
}

func TestIsSentence(t *testing.T) {
	cases := map[string]bool{
		"hello":       false,
		"hello world": true,
		"":            false,
		" ":           true,
	}
	for raw, want := range cases {
		if got := isSentence(raw); got != want {
			t.Errorf("isSentence(%q) = %v, want %v", raw, got, want)
		}
	}
}

func setupTranslateRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/translate", Translate)
	r.GET("/word/:word", TranslateByWord)
	return r
}

func TestTranslateRejectsUnauthenticatedRequest(t *testing.T) {
	r := setupTranslateRouter()

	req := httptest.NewRequest(http.MethodGet, "/translate?word=hello", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}
}

// A multi-word input short-circuits to respondSentenceUnavailable before any
// database access, so this is safe to exercise without a DB.
func TestTranslateWordRespondsSentenceUnavailableForAuthenticatedMultiWordInput(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "u1")

	translateWord(c, "hello world")

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", w.Code)
	}

	var word struct {
		English string `json:"English"`
		Chinese string `json:"Chinese"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &word); err != nil {
		t.Fatal(err)
	}
	if word.English != "hello world" {
		t.Errorf("english: %q", word.English)
	}
	if word.Chinese != SentenceTranslationNotice {
		t.Errorf("chinese: %q", word.Chinese)
	}
}

func TestTranslateByWordRejectsUnauthenticatedRequest(t *testing.T) {
	r := setupTranslateRouter()

	req := httptest.NewRequest(http.MethodGet, "/word/hello", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}
}
