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

func TestListHandlerReturnsNewestReports(t *testing.T) {
	gin.SetMode(gin.TestMode)
	user := "u-" + t.Name()
	body := `{"url":"https://list-handler.example/page","reason":"no-words","adapter":"generic","extVersion":"2.0.0"}`
	if w := post(t, user, body); w.Code != http.StatusOK {
		t.Fatalf("seed submit: %d %s", w.Code, w.Body.String())
	}

	router := gin.New()
	router.GET("/api/admin/page-reports", ListHandler)
	req := httptest.NewRequest(http.MethodGet, "/api/admin/page-reports", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list status %d body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool `json:"success"`
		Reports []struct {
			URL    string `json:"url"`
			Host   string `json:"host"`
			Reason string `json:"reason"`
			UserID string `json:"userId"`
		} `json:"reports"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || !resp.Success {
		t.Fatalf("resp=%+v err=%v", resp, err)
	}
	found := false
	for _, r := range resp.Reports {
		if r.UserID == user && r.URL == "https://list-handler.example/page" && r.Reason == "no-words" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("seeded report not in list: %+v", resp.Reports)
	}
}
