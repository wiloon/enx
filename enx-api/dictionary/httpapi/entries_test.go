package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"enx-api/dictionary"

	"github.com/gin-gonic/gin"
)

type stubResolver map[string]dictionary.Result

func (s stubResolver) Resolve(_ context.Context, english, _ string) (dictionary.Result, error) {
	if res, ok := s[english]; ok {
		return res, nil
	}
	return dictionary.Result{English: english, Source: dictionary.SourceMiss}, nil
}

type stubMeter struct {
	charged []int
	err     error
}

func (m *stubMeter) Charge(_ context.Context, _ string, n int) error {
	m.charged = append(m.charged, n)
	return m.err
}

type stubPolicy struct{}

func (stubPolicy) Fallback(context.Context, string) (bool, bool) { return true, false }

type freeTier struct{}

func (freeTier) IsActiveSubscriber(context.Context, string) (bool, error) { return false, nil }

var resolved = stubResolver{
	"ran":      {ID: "w-run", English: "run", Pronunciation: "ræn", Chinese: "v. 跑", Source: dictionary.SourceEcdict, Origin: dictionary.OriginECDICT},
	"uncached": {English: "uncached", Chinese: "未缓存", Source: dictionary.SourceEcdict, Origin: dictionary.OriginECDICT},
	"slow":     {English: "slow", Source: dictionary.SourceTimeout},
}

// serveEntries sends body with contentType as userID to a router wired like
// production's QUERY route and returns the recorder.
func serveEntries(t *testing.T, meter *stubMeter, userID, contentType, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	h := NewHandler(dictionary.NewEntries(resolved, meter, stubPolicy{}, nil), freeTier{})
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if userID != "" {
			c.Set("user_id", userID)
		}
	})
	r.Handle("QUERY", "/api/dictionary/entries", h.Entries)
	w := httptest.NewRecorder()
	req := httptest.NewRequest("QUERY", "/api/dictionary/entries", strings.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	r.ServeHTTP(w, req)
	return w
}

func TestEntriesAnswersEachWordUnderItsRequestedForm(t *testing.T) {
	meter := &stubMeter{}

	w := serveEntries(t, meter, "u1", "application/json", `{"words":["ran","uncached","zzxqv","slow"]}`)

	if w.Code != http.StatusOK || w.Header().Get("Accept-Query") != "application/json" {
		t.Fatalf("got %d, Accept-Query %q (body=%s); want 200 and application/json", w.Code, w.Header().Get("Accept-Query"), w.Body)
	}
	var got []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode %s: %v", w.Body, err)
	}
	want := []map[string]any{
		{"Word": "ran", "Status": "found", "Id": "w-run", "English": "run", "Pronunciation": "ræn", "Chinese": "v. 跑", "WordType": float64(0), "Origin": "ecdict"},
		{"Word": "uncached", "Status": "found", "English": "uncached", "Pronunciation": "", "Chinese": "未缓存", "WordType": float64(0), "Origin": "ecdict"},
		{"Word": "zzxqv", "Status": "not_found", "AIFallback": map[string]any{"CanUse": true, "Auto": false}},
		{"Word": "slow", "Status": "failed"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		g, _ := json.Marshal(got[i])
		e, _ := json.Marshal(want[i])
		if string(g) != string(e) {
			t.Errorf("result %d = %s, want %s", i, g, e)
		}
	}
	if len(meter.charged) != 1 || meter.charged[0] != 4 {
		t.Fatalf("charges %v, want [4]", meter.charged)
	}
}

// RFC 10008: a QUERY whose content type is not JSON is refused before the
// body is read.
func TestEntriesRequiresAJSONContentType(t *testing.T) {
	for _, contentType := range []string{"", "text/plain"} {
		meter := &stubMeter{}

		w := serveEntries(t, meter, "u1", contentType, `{"words":["ran"]}`)

		if w.Code != http.StatusUnsupportedMediaType || len(meter.charged) != 0 {
			t.Errorf("content type %q: got %d with charges %v, want 415 and none", contentType, w.Code, meter.charged)
		}
	}
}

func TestEntriesRejectsABadBodyWith400AndNoCharge(t *testing.T) {
	for _, body := range []string{
		`not json`,
		`{}`,
		`{"words":[]}`,
		`{"words":["good morning"]}`,
		`{"words":["42"]}`,
		`{"words":[` + strings.TrimSuffix(strings.Repeat(`"ran",`, 101), ",") + `]}`,
	} {
		meter := &stubMeter{}

		w := serveEntries(t, meter, "u1", "application/json", body)

		if w.Code != http.StatusBadRequest || len(meter.charged) != 0 {
			t.Errorf("body %.40s: got %d with charges %v, want 400 and none", body, w.Code, meter.charged)
		}
	}
}

func TestEntriesOverQuotaAnswersTheLookupQuota429(t *testing.T) {
	w := serveEntries(t, &stubMeter{err: dictionary.ErrQuotaExceeded}, "u1", "application/json", `{"words":["ran"]}`)

	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if w.Code != http.StatusTooManyRequests || body["code"] != "lookup_quota_exceeded" {
		t.Fatalf("got %d %s, want 429 lookup_quota_exceeded", w.Code, w.Body)
	}
}

func TestEntriesRejectsAnUnauthenticatedRequest(t *testing.T) {
	meter := &stubMeter{}

	w := serveEntries(t, meter, "", "application/json", `{"words":["ran"]}`)

	if w.Code != http.StatusUnauthorized || len(meter.charged) != 0 {
		t.Fatalf("got %d with charges %v, want 401 and none", w.Code, meter.charged)
	}
}
