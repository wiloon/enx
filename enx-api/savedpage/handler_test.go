package savedpage

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// request runs handler behind a stand-in for middleware.ClerkAuth, which is
// what puts user_id on the context in production.
func request(t *testing.T, method, routePattern, requestPath string, handler gin.HandlerFunc, userID, body string) *httptest.ResponseRecorder {
	t.Helper()
	router := gin.New()
	router.Handle(method, routePattern, func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	}, handler)

	req := httptest.NewRequest(method, requestPath, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

type pageJSON struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Title     string `json:"title"`
	Host      string `json:"host"`
	CreatedAt string `json:"createdAt"`
}

func TestSaveHandlerCreatesThenReportsAnExistingPage(t *testing.T) {
	user := "u-" + t.Name()
	body := `{"url":"https://www.infoq.com/articles/kube?utm_source=x","title":"Kube"}`

	w := request(t, http.MethodPost, "/api/saved-pages", "/api/saved-pages", SaveHandler, user, body)
	if w.Code != http.StatusCreated {
		t.Fatalf("first save: status %d body=%s, want 201", w.Code, w.Body.String())
	}
	var created struct {
		Success bool     `json:"success"`
		Created bool     `json:"created"`
		Page    pageJSON `json:"page"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, w.Body.String())
	}
	if !created.Success || !created.Created || created.Page.ID == "" ||
		created.Page.URL != "https://www.infoq.com/articles/kube" ||
		created.Page.Title != "Kube" || created.Page.Host != "www.infoq.com" || created.Page.CreatedAt == "" {
		t.Fatalf("unexpected response: %+v", created)
	}

	w = request(t, http.MethodPost, "/api/saved-pages", "/api/saved-pages", SaveHandler, user, body)
	if w.Code != http.StatusOK {
		t.Fatalf("saving again: status %d body=%s, want 200", w.Code, w.Body.String())
	}
	var again struct {
		Created bool     `json:"created"`
		Page    pageJSON `json:"page"`
	}
	json.Unmarshal(w.Body.Bytes(), &again)
	if again.Created || again.Page.ID != created.Page.ID {
		t.Fatalf("saving again: %+v, want created=false and the same page", again)
	}
}

func TestSaveHandlerRejectionsHaveSpecificStatusCodes(t *testing.T) {
	user := "u-" + t.Name()
	post := func(u, body string) *httptest.ResponseRecorder {
		return request(t, http.MethodPost, "/api/saved-pages", "/api/saved-pages", SaveHandler, u, body)
	}

	if w := post(user, `not json`); w.Code != http.StatusBadRequest {
		t.Errorf("malformed body: status %d, want 400", w.Code)
	}
	if w := post(user, `{"url":"javascript:alert(1)","title":"x"}`); w.Code != http.StatusBadRequest {
		t.Errorf("non-web URL: status %d body=%s, want 400", w.Code, w.Body.String())
	}

	full := "u-full-" + t.Name()
	fillToLimit(t, full)
	if w := post(full, `{"url":"https://example.com/one-too-many","title":"x"}`); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("past the limit: status %d body=%s, want 422", w.Code, w.Body.String())
	}
}

func TestListHandlerReturnsOnlyTheCallersPagesNewestFirst(t *testing.T) {
	alice, bob := "u-alice-"+t.Name(), "u-bob-"+t.Name()
	for i, u := range []string{"https://example.com/old", "https://example.com/new"} {
		body := `{"url":"` + u + `","title":"t"}`
		w := request(t, http.MethodPost, "/api/saved-pages", "/api/saved-pages", SaveHandler, alice, body)
		if w.Code != http.StatusCreated {
			t.Fatalf("seed %d: status %d", i, w.Code)
		}
		time.Sleep(2 * time.Millisecond) // created_at has millisecond resolution
	}
	request(t, http.MethodPost, "/api/saved-pages", "/api/saved-pages", SaveHandler, bob, `{"url":"https://example.com/bobs","title":"t"}`)

	w := request(t, http.MethodGet, "/api/saved-pages", "/api/saved-pages", ListHandler, alice, "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool       `json:"success"`
		Pages   []pageJSON `json:"pages"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !resp.Success || len(resp.Pages) != 2 ||
		resp.Pages[0].URL != "https://example.com/new" || resp.Pages[1].URL != "https://example.com/old" {
		t.Fatalf("unexpected list: %+v", resp)
	}
}

func TestListHandlerReturnsAnEmptyArrayNotNull(t *testing.T) {
	w := request(t, http.MethodGet, "/api/saved-pages", "/api/saved-pages", ListHandler, "u-"+t.Name(), "")
	var raw map[string]json.RawMessage
	json.Unmarshal(w.Body.Bytes(), &raw)
	if string(raw["pages"]) != "[]" {
		t.Fatalf(`"pages" is %s, want [] so clients can iterate without a null check`, raw["pages"])
	}
}

func savePage(t *testing.T, user, url string) pageJSON {
	t.Helper()
	w := request(t, http.MethodPost, "/api/saved-pages", "/api/saved-pages", SaveHandler, user, `{"url":"`+url+`","title":"t"}`)
	var resp struct {
		Page pageJSON `json:"page"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || resp.Page.ID == "" {
		t.Fatalf("seed %s: status %d body=%s", url, w.Code, w.Body.String())
	}
	return resp.Page
}

func patch(t *testing.T, user, id, body string) *httptest.ResponseRecorder {
	t.Helper()
	return request(t, http.MethodPatch, "/api/saved-pages/:id", "/api/saved-pages/"+id, UpdateHandler, user, body)
}

func TestUpdateHandlerEditsAndMapsFailuresToStatusCodes(t *testing.T) {
	user := "u-" + t.Name()
	page := savePage(t, user, "https://example.com/a")
	savePage(t, user, "https://example.com/taken")

	w := patch(t, user, page.ID, `{"title":"my note","url":"https://example.com/b#x"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("edit: status %d body=%s, want 200", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool     `json:"success"`
		Page    pageJSON `json:"page"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if !resp.Success || resp.Page.ID != page.ID || resp.Page.Title != "my note" || resp.Page.URL != "https://example.com/b" {
		t.Fatalf("unexpected response: %+v", resp)
	}

	cases := []struct {
		name, user, id, body string
		want                 int
	}{
		{"another user's page", "u-mallory-" + t.Name(), page.ID, `{"title":"x"}`, http.StatusNotFound},
		{"missing page", user, "no-such-id", `{"title":"x"}`, http.StatusNotFound},
		{"URL already saved", user, page.ID, `{"url":"https://example.com/taken"}`, http.StatusConflict},
		{"non-web URL", user, page.ID, `{"url":"javascript:alert(1)"}`, http.StatusBadRequest},
		{"malformed body", user, page.ID, `not json`, http.StatusBadRequest},
		{"nothing to change", user, page.ID, `{}`, http.StatusBadRequest},
	}
	for _, c := range cases {
		if w := patch(t, c.user, c.id, c.body); w.Code != c.want {
			t.Errorf("%s: status %d body=%s, want %d", c.name, w.Code, w.Body.String(), c.want)
		}
	}
}

func TestDeleteHandlerRemovesOnlyTheCallersPage(t *testing.T) {
	alice, mallory := "u-alice-"+t.Name(), "u-mallory-"+t.Name()
	page := savePage(t, alice, "https://example.com/a")
	del := func(user, id string) *httptest.ResponseRecorder {
		return request(t, http.MethodDelete, "/api/saved-pages/:id", "/api/saved-pages/"+id, DeleteHandler, user, "")
	}

	if w := del(mallory, page.ID); w.Code != http.StatusNotFound {
		t.Fatalf("another user's page: status %d, want 404", w.Code)
	}
	if w := del(alice, "no-such-id"); w.Code != http.StatusNotFound {
		t.Fatalf("missing page: status %d, want 404", w.Code)
	}
	if w := del(alice, page.ID); w.Code != http.StatusOK {
		t.Fatalf("own page: status %d body=%s, want 200", w.Code, w.Body.String())
	}
	w := request(t, http.MethodGet, "/api/saved-pages", "/api/saved-pages", ListHandler, alice, "")
	var resp struct {
		Pages []pageJSON `json:"pages"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if len(resp.Pages) != 0 {
		t.Fatalf("page still listed after delete: %+v", resp.Pages)
	}
}

func TestDeleteAllHandlerClearsTheCallersListAndReportsHowMany(t *testing.T) {
	alice, bob := "u-alice-"+t.Name(), "u-bob-"+t.Name()
	savePage(t, alice, "https://example.com/a1")
	savePage(t, alice, "https://example.com/a2")
	savePage(t, bob, "https://example.com/b1")

	w := request(t, http.MethodDelete, "/api/saved-pages", "/api/saved-pages", DeleteAllHandler, alice, "")
	var resp struct {
		Success bool  `json:"success"`
		Deleted int64 `json:"deleted"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if w.Code != http.StatusOK || !resp.Success || resp.Deleted != 2 {
		t.Fatalf("status %d resp=%+v, want 200 and deleted=2", w.Code, resp)
	}
	if pages, _ := List(context.Background(), bob); len(pages) != 1 {
		t.Fatalf("bob has %d pages, want 1 (untouched)", len(pages))
	}
}

func TestExportHandlerDownloadsTheCallersPagesWithoutInternalIDs(t *testing.T) {
	alice, bob := "u-alice-"+t.Name(), "u-bob-"+t.Name()
	savePage(t, alice, "https://example.com/mine")
	savePage(t, bob, "https://example.com/not-mine")

	w := request(t, http.MethodGet, "/api/saved-pages/export", "/api/saved-pages/export", ExportHandler, alice, "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body=%s", w.Code, w.Body.String())
	}
	if cd := w.Header().Get("Content-Disposition"); cd != `attachment; filename="catglish-saved-pages.json"` {
		t.Fatalf("Content-Disposition = %q, want an attachment download", cd)
	}

	var export struct {
		ExportedAt string `json:"exportedAt"`
		Items      []map[string]any
	}
	if err := json.Unmarshal(w.Body.Bytes(), &export); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, w.Body.String())
	}
	if export.ExportedAt == "" || len(export.Items) != 1 {
		t.Fatalf("unexpected export: %s", w.Body.String())
	}
	item := export.Items[0]
	if item["url"] != "https://example.com/mine" || item["title"] != "t" || item["savedAt"] == "" {
		t.Fatalf("unexpected item: %+v", item)
	}
	if len(item) != 3 {
		t.Fatalf("item has fields %v, want exactly url, title, savedAt (no ids, no user id)", item)
	}
}
