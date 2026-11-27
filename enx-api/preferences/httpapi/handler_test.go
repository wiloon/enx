package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"enx-api/entitlement"
	"enx-api/preferences"

	"github.com/gin-gonic/gin"
)

// memStore keeps one user's explicit values in memory.
type memStore struct {
	values  map[preferences.Key]any
	loadErr error
	saveErr error
}

func (m *memStore) Load(context.Context, string) (map[preferences.Key]any, error) {
	return m.values, m.loadErr
}

func (m *memStore) Save(_ context.Context, _ string, key preferences.Key, value any) error {
	if m.saveErr != nil {
		return m.saveErr
	}
	m.values[key] = value
	return nil
}

func (m *memStore) Clear(_ context.Context, _ string, key preferences.Key) error {
	delete(m.values, key)
	return nil
}

type fixedEnt entitlement.Status

func (f fixedEnt) Status(context.Context, string) (entitlement.Status, error) {
	return entitlement.Status(f), nil
}

var subscriber = entitlement.Status{Subscribed: true, CanUseAI: true}

func newStore() *memStore { return &memStore{values: map[preferences.Key]any{}} }

func handler(store *memStore, status entitlement.Status) *Handler {
	return NewHandler(preferences.NewService(store, fixedEnt(status)))
}

func request(h gin.HandlerFunc, method, userID, body string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, "/api/me/preferences", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if userID != "" {
		c.Set("user_id", userID)
	}
	h(c)
	return w
}

// wire returns one preference of a response body, re-encoded with sorted keys.
func wire(t *testing.T, w *httptest.ResponseRecorder, key string) string {
	t.Helper()
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body)
	}
	var body map[string]map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	got, err := json.Marshal(body[key])
	if err != nil {
		t.Fatal(err)
	}
	return string(got)
}

func TestGetWireShape(t *testing.T) {
	store := newStore()
	store.values[preferences.AIWordFallbackNoticeAck] = true
	w := request(handler(store, subscriber).Get, http.MethodGet, "u1", "")

	for key, want := range map[string]string{
		// An unset preference is null, not omitted: clients rely on the key.
		"aiWordFallback":          `{"editable":true,"effective":true,"value":null}`,
		"aiWordFallbackNoticeAck": `{"editable":true,"effective":true,"value":true}`,
		"explanationLanguage":     `{"editable":true,"effective":"zh-Hans","value":null}`,
	} {
		if got := wire(t, w, key); got != want {
			t.Errorf("%s = %s, want %s", key, got, want)
		}
	}
}

func TestPutStoresAndClears(t *testing.T) {
	store := newStore()
	h := handler(store, subscriber)

	w := request(h.Update, http.MethodPut, "u1", `{"explanationLanguage":"en","aiWordFallback":false}`)
	if got, want := wire(t, w, "explanationLanguage"), `{"editable":true,"effective":"en","value":"en"}`; got != want {
		t.Fatalf("explanationLanguage = %s, want %s", got, want)
	}
	if got, want := wire(t, w, "aiWordFallback"), `{"editable":true,"effective":false,"value":false}`; got != want {
		t.Fatalf("aiWordFallback = %s, want %s", got, want)
	}

	w = request(h.Update, http.MethodPut, "u1", `{"explanationLanguage":null}`)
	if got, want := wire(t, w, "explanationLanguage"), `{"editable":true,"effective":"zh-Hans","value":null}`; got != want {
		t.Fatalf("explanationLanguage after null = %s, want %s", got, want)
	}
	if _, ok := store.values[preferences.ExplanationLanguage]; ok {
		t.Fatal("null should clear the stored value")
	}
}

func TestPutRejections(t *testing.T) {
	for _, tc := range []struct {
		name     string
		status   entitlement.Status
		saveErr  error
		body     string
		wantCode int
		wantBody string
	}{
		{"empty body", subscriber, nil, ``, http.StatusBadRequest, "invalid_body"},
		{"not an object", subscriber, nil, `[true]`, http.StatusBadRequest, "invalid_body"},
		{"empty object", subscriber, nil, `{}`, http.StatusBadRequest, "invalid_body"},
		{"a string for a boolean key", subscriber, nil, `{"aiWordFallback":"yes"}`, http.StatusBadRequest, "invalid_value"},
		{"a number for a boolean key", subscriber, nil, `{"aiWordFallback":1}`, http.StatusBadRequest, "invalid_value"},
		{"a boolean for the enum key", subscriber, nil, `{"explanationLanguage":true}`, http.StatusBadRequest, "invalid_value"},
		{"a language not on the list", subscriber, nil, `{"explanationLanguage":"zh-Hant"}`, http.StatusBadRequest, "invalid_value"},
		{"unknown key", subscriber, nil, `{"nope":true}`, http.StatusBadRequest, "unknown_preference"},
		{"unknown key with a string", subscriber, nil, `{"nope":"en"}`, http.StatusBadRequest, "unknown_preference"},
		{"not entitled", entitlement.Status{}, nil, `{"aiWordFallback":true}`, http.StatusForbidden, "not_entitled"},
		{"storage failure", subscriber, errors.New("db down"), `{"aiWordFallback":true}`, http.StatusInternalServerError, "temporarily unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := newStore()
			store.saveErr = tc.saveErr
			w := request(handler(store, tc.status).Update, http.MethodPut, "u1", tc.body)
			if w.Code != tc.wantCode {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.wantCode, w.Body)
			}
			if !strings.Contains(w.Body.String(), tc.wantBody) {
				t.Fatalf("body %s does not mention %q", w.Body, tc.wantBody)
			}
			if strings.Contains(w.Body.String(), "db down") {
				t.Fatal("a storage error must not leak to the client")
			}
			if len(store.values) != 0 {
				t.Fatalf("a rejected update wrote %v", store.values)
			}
		})
	}
}

func TestRequireAUser(t *testing.T) {
	h := handler(newStore(), subscriber)
	if w := request(h.Get, http.MethodGet, "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("GET without a user: status %d, want 401", w.Code)
	}
	if w := request(h.Update, http.MethodPut, "", `{"aiWordFallback":true}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("PUT without a user: status %d, want 401", w.Code)
	}
}

func TestGetStorageFailureDoesNotLeak(t *testing.T) {
	store := newStore()
	store.loadErr = errors.New("secret db detail")
	w := request(handler(store, subscriber).Get, http.MethodGet, "u1", "")
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status %d, want 500", w.Code)
	}
	if strings.Contains(w.Body.String(), "secret db detail") {
		t.Fatal("the underlying error leaked to the client")
	}
}
