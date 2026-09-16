package reader

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// setUserID simulates what middleware.ClerkAuth sets on the context.
func setUserID(userID string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	}
}

func doRequest(t *testing.T, method, path string, handler gin.HandlerFunc, userID, body string) *httptest.ResponseRecorder {
	t.Helper()
	return doParamRequest(t, method, path, path, handler, userID, body)
}

// doParamRequest is doRequest for routes with gin path params: routePattern
// is what gets registered (e.g. "/api/reader/documents/:id"), requestPath is
// the concrete URL the test request hits (e.g. "/api/reader/documents/abc").
func doParamRequest(t *testing.T, method, routePattern, requestPath string, handler gin.HandlerFunc, userID, body string) *httptest.ResponseRecorder {
	t.Helper()
	router := gin.New()
	router.Handle(method, routePattern, setUserID(userID), handler)

	req := httptest.NewRequest(method, requestPath, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func TestCreateDocumentHandlerCreatesDocument(t *testing.T) {
	w := doRequest(t, http.MethodPost, "/api/reader/documents", CreateDocumentHandler,
		"u-"+t.Name(), `{"content":"hello world"}`)

	if w.Code != http.StatusCreated {
		t.Fatalf("status: got %d want %d, body=%s", w.Code, http.StatusCreated, w.Body.String())
	}

	var resp struct {
		Success bool   `json:"success"`
		ID      string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v, body=%s", err, w.Body.String())
	}
	if !resp.Success || resp.ID == "" {
		t.Fatalf("got %+v, want success=true and non-empty id", resp)
	}
}

func TestCreateDocumentHandlerRejectsContentOverMaxLength(t *testing.T) {
	tooLong := make([]byte, MaxContentLength+1)
	for i := range tooLong {
		tooLong[i] = 'a'
	}
	body, err := json.Marshal(map[string]string{"content": string(tooLong)})
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}

	w := doRequest(t, http.MethodPost, "/api/reader/documents", CreateDocumentHandler,
		"u-"+t.Name(), string(body))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want %d, body=%s", w.Code, http.StatusBadRequest, w.Body.String())
	}
}

func TestListDocumentsHandlerReturnsUsersDocuments(t *testing.T) {
	userID := "u-" + t.Name()

	create := doRequest(t, http.MethodPost, "/api/reader/documents", CreateDocumentHandler, userID, `{"content":"first"}`)
	if create.Code != http.StatusCreated {
		t.Fatalf("setup create status: got %d, body=%s", create.Code, create.Body.String())
	}

	w := doRequest(t, http.MethodGet, "/api/reader/documents", ListDocumentsHandler, userID, "")
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want %d, body=%s", w.Code, http.StatusOK, w.Body.String())
	}

	var resp struct {
		Success   bool `json:"success"`
		Documents []struct {
			ID      string `json:"id"`
			Preview string `json:"preview"`
		} `json:"documents"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v, body=%s", err, w.Body.String())
	}
	if !resp.Success || len(resp.Documents) != 1 {
		t.Fatalf("got %+v, want success=true and 1 document", resp)
	}
	if resp.Documents[0].Preview != "first" {
		t.Fatalf("got preview %q, want %q", resp.Documents[0].Preview, "first")
	}
}

func TestGetDocumentHandlerReturnsFullContent(t *testing.T) {
	userID := "u-" + t.Name()

	created := doRequest(t, http.MethodPost, "/api/reader/documents", CreateDocumentHandler, userID, `{"content":"full text"}`)
	var createResp struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal create response: %v", err)
	}

	w := doParamRequest(t, http.MethodGet, "/api/reader/documents/:id", "/api/reader/documents/"+createResp.ID, GetDocumentHandler, userID, "")
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want %d, body=%s", w.Code, http.StatusOK, w.Body.String())
	}

	var resp struct {
		Success bool   `json:"success"`
		ID      string `json:"id"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v, body=%s", err, w.Body.String())
	}
	if !resp.Success || resp.Content != "full text" {
		t.Fatalf("got %+v, want success=true and content=%q", resp, "full text")
	}
}

func TestGetDocumentHandlerReturns404WhenNotFound(t *testing.T) {
	w := doParamRequest(t, http.MethodGet, "/api/reader/documents/:id", "/api/reader/documents/does-not-exist",
		GetDocumentHandler, "u-"+t.Name(), "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("status: got %d want %d, body=%s", w.Code, http.StatusNotFound, w.Body.String())
	}
}

func TestUpdateDocumentHandlerReplacesContent(t *testing.T) {
	userID := "u-" + t.Name()

	created := doRequest(t, http.MethodPost, "/api/reader/documents", CreateDocumentHandler, userID, `{"content":"original"}`)
	var createResp struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal create response: %v", err)
	}

	w := doParamRequest(t, http.MethodPut, "/api/reader/documents/:id", "/api/reader/documents/"+createResp.ID,
		UpdateDocumentHandler, userID, `{"content":"revised"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want %d, body=%s", w.Code, http.StatusOK, w.Body.String())
	}

	var resp struct {
		Success bool   `json:"success"`
		ID      string `json:"id"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v, body=%s", err, w.Body.String())
	}
	if !resp.Success || resp.Content != "revised" {
		t.Fatalf("got %+v, want success=true and content=%q", resp, "revised")
	}

	get := doParamRequest(t, http.MethodGet, "/api/reader/documents/:id", "/api/reader/documents/"+createResp.ID,
		GetDocumentHandler, userID, "")
	var getResp struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &getResp); err != nil {
		t.Fatalf("unmarshal get response: %v", err)
	}
	if getResp.Content != "revised" {
		t.Fatalf("GET after update returned content=%q, want %q", getResp.Content, "revised")
	}
}

func TestUpdateDocumentHandlerReturns404WhenNotFound(t *testing.T) {
	w := doParamRequest(t, http.MethodPut, "/api/reader/documents/:id", "/api/reader/documents/does-not-exist",
		UpdateDocumentHandler, "u-"+t.Name(), `{"content":"revised"}`)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status: got %d want %d, body=%s", w.Code, http.StatusNotFound, w.Body.String())
	}
}

func TestUpdateDocumentHandlerRejectsContentOverMaxLength(t *testing.T) {
	userID := "u-" + t.Name()

	created := doRequest(t, http.MethodPost, "/api/reader/documents", CreateDocumentHandler, userID, `{"content":"original"}`)
	var createResp struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal create response: %v", err)
	}

	tooLong := make([]byte, MaxContentLength+1)
	for i := range tooLong {
		tooLong[i] = 'a'
	}
	body, err := json.Marshal(map[string]string{"content": string(tooLong)})
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}

	w := doParamRequest(t, http.MethodPut, "/api/reader/documents/:id", "/api/reader/documents/"+createResp.ID,
		UpdateDocumentHandler, userID, string(body))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want %d, body=%s", w.Code, http.StatusBadRequest, w.Body.String())
	}
}

func TestDeleteDocumentHandlerRemovesDocument(t *testing.T) {
	userID := "u-" + t.Name()

	created := doRequest(t, http.MethodPost, "/api/reader/documents", CreateDocumentHandler, userID, `{"content":"to delete"}`)
	var createResp struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal create response: %v", err)
	}

	del := doParamRequest(t, http.MethodDelete, "/api/reader/documents/:id", "/api/reader/documents/"+createResp.ID,
		DeleteDocumentHandler, userID, "")
	if del.Code != http.StatusOK {
		t.Fatalf("delete status: got %d want %d, body=%s", del.Code, http.StatusOK, del.Body.String())
	}

	get := doParamRequest(t, http.MethodGet, "/api/reader/documents/:id", "/api/reader/documents/"+createResp.ID,
		GetDocumentHandler, userID, "")
	if get.Code != http.StatusNotFound {
		t.Fatalf("get-after-delete status: got %d want %d (document should be gone)", get.Code, http.StatusNotFound)
	}
}
