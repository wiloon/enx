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
