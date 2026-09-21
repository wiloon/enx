package pagereport

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func post(t *testing.T, userID, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/page-reports", func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	}, SubmitHandler)
	req := httptest.NewRequest(http.MethodPost, "/api/page-reports", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func TestSubmitHandlerRecordsThenReportsDuplicate(t *testing.T) {
	user := "u-" + t.Name()
	body := `{"url":"https://x.com/a/status/1?s=20","reason":"no-article-node","adapter":"x","extVersion":"1.0.1"}`

	for i, want := range []bool{true, false} {
		w := post(t, user, body)
		if w.Code != http.StatusOK {
			t.Fatalf("call %d: status %d body=%s", i, w.Code, w.Body.String())
		}
		var resp struct {
			Success  bool `json:"success"`
			Recorded bool `json:"recorded"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || !resp.Success || resp.Recorded != want {
			t.Fatalf("call %d: resp=%+v err=%v, want recorded=%v", i, resp, err, want)
		}
	}
}

func TestSubmitHandlerRejectsBadRequests(t *testing.T) {
	user := "u-" + t.Name()
	for name, body := range map[string]string{
		"not json":       `nope`,
		"bad url":        `{"url":"chrome://extensions","reason":"no-article-node"}`,
		"unknown reason": `{"url":"https://x.com/a","reason":"lookup-failed"}`,
		"bad adapter":    `{"url":"https://x.com/a","reason":"error","adapter":"A B"}`,
	} {
		if w := post(t, user, body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400 (body=%s)", name, w.Code, w.Body.String())
		}
	}
}
