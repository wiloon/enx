//go:build integration

package reader_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"enx-api/reader"
	"enx-api/reader/saving"
	"enx-api/repo"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func saveRouter(t *testing.T) *gin.Engine {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "reader.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&sqlitex.ReaderDocument{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	previousDB := sqlitex.DB
	sqlitex.DB = db
	t.Cleanup(func() { sqlitex.DB = previousDB })
	r := gin.New()
	r.PUT("/documents/:id", func(c *gin.Context) { c.Set("user_id", c.GetHeader("X-Test-User")); c.Next() }, reader.NewSaveDocumentHandler(saving.NewSaveService(repo.ReaderDocuments{DB: db})))
	return r
}

func save(t *testing.T, r http.Handler, id, user, content string, version int64) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{"content": content, "version": version})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPut, "/documents/"+id, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-User", user)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestSaveDocumentCreatesWithClientUUID(t *testing.T) {
	const id = "9c14d6dd-9d0e-42c9-92b7-c8786a43d909"
	w := save(t, saveRouter(t), id, "user", "first version", 1)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		ID      string `json:"id"`
		Version int64  `json:"version"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.ID != id || resp.Version != 1 {
		t.Fatalf("got %+v", resp)
	}
}

func TestLegacyUpdateCannotBypassDocumentVersions(t *testing.T) {
	r := saveRouter(t)
	const id = "9c14d6dd-9d0e-42c9-92b7-c8786a43d909"
	if w := save(t, r, id, "owner", "versioned", 1); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	req := httptest.NewRequest(http.MethodPut, "/documents/"+id, bytes.NewBufferString(`{"content":"unversioned overwrite"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-User", "owner")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestOutOfOrderSavesKeepHighestVersion(t *testing.T) {
	r := saveRouter(t)
	const id = "9c14d6dd-9d0e-42c9-92b7-c8786a43d909"
	for _, version := range []int64{3, 1, 2} {
		w := save(t, r, id, "owner", fmt.Sprintf("version %d", version), version)
		if w.Code != 200 {
			t.Fatalf("version %d: %s", version, w.Body.String())
		}
	}
	doc, err := reader.GetDocument(context.Background(), "owner", id, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if doc.Version != 3 || doc.Content != "version 3" {
		t.Fatalf("wrong persisted document: %+v", doc)
	}
}

func TestSaveHTTPRejectsOtherOwners(t *testing.T) {
	r := saveRouter(t)
	const id = "9c14d6dd-9d0e-42c9-92b7-c8786a43d909"
	if w := save(t, r, id, "owner", "private", 1); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w := save(t, r, id, "stranger", "takeover", 10)
	if w.Code != 404 {
		t.Fatalf("foreign owner: %d %s", w.Code, w.Body.String())
	}
	doc, err := reader.GetDocument(context.Background(), "owner", id, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if doc.Content != "private" {
		t.Fatalf("foreign save changed content: %+v", doc)
	}
}

func TestSaveHTTPReportsSameVersionConflict(t *testing.T) {
	r := saveRouter(t)
	const id = "9c14d6dd-9d0e-42c9-92b7-c8786a43d909"
	if w := save(t, r, id, "owner", "first tab", 1); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w := save(t, r, id, "owner", "second tab", 1)
	if w.Code != 409 {
		t.Fatalf("conflict: %d %s", w.Code, w.Body.String())
	}
	var body struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body.Message, "Reopen it from My Documents") {
		t.Fatalf("missing recovery instruction: %s", body.Message)
	}
}

func TestConcurrentSavesKeepHighestVersion(t *testing.T) {
	r := saveRouter(t)
	const id = "9c14d6dd-9d0e-42c9-92b7-c8786a43d909"
	start := make(chan struct{})
	responses := make(chan *httptest.ResponseRecorder, 12)
	for version := int64(1); version <= 12; version++ {
		go func(v int64) { <-start; responses <- save(t, r, id, "owner", fmt.Sprintf("version %d", v), v) }(version)
	}
	close(start)
	for i := 0; i < 12; i++ {
		w := <-responses
		if w.Code != 200 {
			t.Fatalf("concurrent save: %d %s", w.Code, w.Body.String())
		}
	}
	doc, err := reader.GetDocument(context.Background(), "owner", id, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if doc.Version != 12 || doc.Content != "version 12" {
		t.Fatalf("lost latest save: %+v", doc)
	}
}

func TestOnlyNewDocumentsEvictAtTheCap(t *testing.T) {
	r := saveRouter(t)
	ids := make([]string, reader.MaxDocumentsPerUser)
	for i := range ids {
		ids[i] = uuid.NewString()
		w := save(t, r, ids[i], "owner", "original", 1)
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	// Set an unambiguous oldest creation time; fast inserts can share a millisecond.
	if err := sqlitex.DB.Model(&sqlitex.ReaderDocument{}).Where("id = ?", ids[0]).Update("created_at", time.Now().Add(-time.Hour).UnixMilli()).Error; err != nil {
		t.Fatal(err)
	}
	if w := save(t, r, ids[0], "owner", "updated", 2); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := save(t, r, ids[0], "owner", "updated", 2); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	docs, err := reader.ListDocuments(context.Background(), "owner", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(docs) != reader.MaxDocumentsPerUser {
		t.Fatalf("update evicted a document: %d", len(docs))
	}
	if w := save(t, r, uuid.NewString(), "owner", "new", 1); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	docs, err = reader.ListDocuments(context.Background(), "owner", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(docs) != reader.MaxDocumentsPerUser {
		t.Fatalf("cap not enforced: %d", len(docs))
	}
	if _, err = reader.GetDocument(context.Background(), "owner", ids[0], time.Now()); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("oldest was not evicted: %v", err)
	}
}

func TestLegacyDocumentCanBeOpenedAndSavedWithAVersion(t *testing.T) {
	r := saveRouter(t)
	old, err := reader.CreateDocument(context.Background(), "owner", "legacy text", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	r.GET("/documents/:id", func(c *gin.Context) { c.Set("user_id", "owner"); c.Next() }, reader.GetDocumentHandler)
	open := func() map[string]any {
		t.Helper()
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/documents/"+old.ID, nil))
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		var data map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil {
			t.Fatal(err)
		}
		return data
	}
	if got := open()["version"]; got != float64(0) {
		t.Fatalf("legacy version=%v", got)
	}
	if w := save(t, r, old.ID, "owner", "edited legacy text", 1); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	doc := open()
	if doc["version"] != float64(1) || doc["content"] != "edited legacy text" {
		t.Fatalf("got %+v", doc)
	}
}

func TestFailedInsertRollsBackCapEviction(t *testing.T) {
	r := saveRouter(t)
	oldest, err := reader.CreateDocument(context.Background(), "owner", "keep oldest", time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i < reader.MaxDocumentsPerUser; i++ {
		if _, err := reader.CreateDocument(context.Background(), "owner", "other", time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if err := sqlitex.DB.Exec(`CREATE TRIGGER fail_reader_insert BEFORE INSERT ON reader_documents BEGIN SELECT RAISE(ABORT, 'test insert failure'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if w := save(t, r, uuid.NewString(), "owner", "cannot insert", 1); w.Code != 500 {
		t.Fatalf("status=%d %s", w.Code, w.Body.String())
	}
	docs, err := reader.ListDocuments(context.Background(), "owner", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(docs) != reader.MaxDocumentsPerUser {
		t.Fatalf("failed save evicted a document: %d", len(docs))
	}
	if _, err := reader.GetDocument(context.Background(), "owner", oldest.ID, time.Now()); err != nil {
		t.Fatalf("oldest missing after rollback: %v", err)
	}
}

func TestSaveRejectsInvalidRequests(t *testing.T) {
	r := saveRouter(t)
	const id = "9c14d6dd-9d0e-42c9-92b7-c8786a43d909"
	cases := []string{`{"content":"text","version":0}`, `{"content":"text","version":1.5}`, `{"content":"text","version":"1"}`, `{"content":"","version":1}`, `not json`}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPut, "/documents/"+id, bytes.NewBufferString(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Test-User", "owner")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != 400 {
				t.Fatalf("status=%d %s", w.Code, w.Body.String())
			}
		})
	}
}
