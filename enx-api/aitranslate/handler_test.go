package aitranslate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

type fakeTranslator struct {
	chinese string
	err     error
}

func (f *fakeTranslator) TranslateSentence(ctx context.Context, sentence string) (string, error) {
	return f.chinese, f.err
}

func doPost(t *testing.T, h *Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/translate/sentence", h.TranslateSentence)

	req := httptest.NewRequest(http.MethodPost, "/api/translate/sentence", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func TestHandlerSuccess(t *testing.T) {
	h := NewHandler(&fakeTranslator{chinese: "你好世界"})
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool   `json:"success"`
		Chinese string `json:"chinese"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Success || resp.Chinese != "你好世界" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestHandlerTranslatorError(t *testing.T) {
	h := NewHandler(&fakeTranslator{err: errors.New("upstream timeout")})
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Success {
		t.Fatal("expected success:false")
	}
}

func TestHandlerNotConfigured(t *testing.T) {
	h := NewHandler(nil)
	w := doPost(t, h, `{"sentence":"Hello world"}`)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d want 502, body=%s", w.Code, w.Body.String())
	}
}

func TestHandlerMissingSentence(t *testing.T) {
	h := NewHandler(&fakeTranslator{chinese: "unused"})
	w := doPost(t, h, `{}`)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d want 400, body=%s", w.Code, w.Body.String())
	}
}
