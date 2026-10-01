package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"enx-api/preferences"

	"github.com/gin-gonic/gin"
)

type fakePrefs struct {
	views      map[preferences.Key]preferences.View
	updateErr  error
	getErr     error
	gotChanges map[string]*bool
}

func (f *fakePrefs) Get(context.Context, string) (map[preferences.Key]preferences.View, error) {
	return f.views, f.getErr
}

func (f *fakePrefs) Update(_ context.Context, _ string, changes map[string]*bool) error {
	f.gotChanges = changes
	return f.updateErr
}

func prefsRequest(h gin.HandlerFunc, method, userID, body string) *httptest.ResponseRecorder {
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

func on() *bool { v := true; return &v }

func TestPreferencesGet(t *testing.T) {
	svc := &fakePrefs{views: map[preferences.Key]preferences.View{
		preferences.AIWordFallback:          {Value: nil, Effective: true, Editable: true},
		preferences.AIWordFallbackNoticeAck: {Value: on(), Effective: true, Editable: true},
	}}
	h := NewPreferencesHandler(svc)

	w := prefsRequest(h.Get, http.MethodGet, "u1", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body)
	}
	var body map[string]preferenceJSON
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if got := body["aiWordFallback"]; got.Value != nil || !got.Effective || !got.Editable {
		t.Fatalf("aiWordFallback = %+v, want unset/effective/editable", got)
	}
	if got := body["aiWordFallbackNoticeAck"]; got.Value == nil || !*got.Value {
		t.Fatalf("aiWordFallbackNoticeAck = %+v, want an explicit true", got)
	}
	// An unset preference is serialized as null, not omitted: clients rely on
	// the key being present.
	if !strings.Contains(w.Body.String(), `"value":null`) {
		t.Fatalf("an unset value should be JSON null: %s", w.Body)
	}
}

func TestPreferencesRequireAUser(t *testing.T) {
	h := NewPreferencesHandler(&fakePrefs{})
	if w := prefsRequest(h.Get, http.MethodGet, "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("GET without a user: status %d, want 401", w.Code)
	}
	if w := prefsRequest(h.Update, http.MethodPut, "", `{"aiWordFallback":true}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("PUT without a user: status %d, want 401", w.Code)
	}
}

func TestPreferencesUpdateParsesBoolAndNull(t *testing.T) {
	svc := &fakePrefs{views: map[preferences.Key]preferences.View{}}
	h := NewPreferencesHandler(svc)

	w := prefsRequest(h.Update, http.MethodPut, "u1", `{"aiWordFallback":false,"aiWordFallbackNoticeAck":null}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", w.Code, w.Body)
	}
	if v, ok := svc.gotChanges["aiWordFallback"]; !ok || v == nil || *v {
		t.Fatalf("aiWordFallback change = %v, want an explicit false", v)
	}
	if v, ok := svc.gotChanges["aiWordFallbackNoticeAck"]; !ok || v != nil {
		t.Fatalf("null change = %v/%v, want present and nil (clear)", v, ok)
	}
}

func TestPreferencesUpdateRejections(t *testing.T) {
	for _, tc := range []struct {
		name     string
		body     string
		svcErr   error
		wantCode int
		wantBody string
	}{
		{"empty body", ``, nil, http.StatusBadRequest, "invalid_body"},
		{"not an object", `[true]`, nil, http.StatusBadRequest, "invalid_body"},
		{"empty object", `{}`, nil, http.StatusBadRequest, "invalid_body"},
		{"non-boolean value", `{"aiWordFallback":"yes"}`, nil, http.StatusBadRequest, "invalid_value"},
		{"number value", `{"aiWordFallback":1}`, nil, http.StatusBadRequest, "invalid_value"},
		{"unknown key", `{"nope":true}`, preferences.ErrUnknownKey, http.StatusBadRequest, "unknown_preference"},
		{"not entitled", `{"aiWordFallback":true}`, preferences.ErrNotEditable, http.StatusForbidden, "not_entitled"},
		{"storage failure", `{"aiWordFallback":true}`, errors.New("db down"), http.StatusInternalServerError, "temporarily unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := NewPreferencesHandler(&fakePrefs{updateErr: tc.svcErr})
			w := prefsRequest(h.Update, http.MethodPut, "u1", tc.body)
			if w.Code != tc.wantCode {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.wantCode, w.Body)
			}
			if !strings.Contains(w.Body.String(), tc.wantBody) {
				t.Fatalf("body %s does not mention %q", w.Body, tc.wantBody)
			}
			if tc.svcErr == nil && strings.Contains(w.Body.String(), "db down") {
				t.Fatal("a storage error must not leak to the client")
			}
		})
	}
}

func TestPreferencesGetStorageFailureDoesNotLeak(t *testing.T) {
	h := NewPreferencesHandler(&fakePrefs{getErr: errors.New("secret db detail")})
	w := prefsRequest(h.Get, http.MethodGet, "u1", "")
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status %d, want 500", w.Code)
	}
	if strings.Contains(w.Body.String(), "secret db detail") {
		t.Fatal("the underlying error leaked to the client")
	}
}
