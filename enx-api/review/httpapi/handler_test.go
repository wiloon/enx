package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"enx-api/dictionary"
	"enx-api/review"

	"github.com/gin-gonic/gin"
)

type fakeService struct {
	candidates []review.Candidate
	due        time.Time
	answerErr  error
	answered   []string
}

func (f *fakeService) Candidates(context.Context, string, int) ([]review.Candidate, error) {
	return f.candidates, nil
}

func (f *fakeService) Answer(_ context.Context, _, wordID string, _ review.Rating) (time.Time, error) {
	f.answered = append(f.answered, wordID)
	return f.due, f.answerErr
}

type stubLanguages struct {
	lang dictionary.Language
	err  error
}

func (s stubLanguages) ExplanationLanguage(context.Context, string) (dictionary.Language, error) {
	return s.lang, s.err
}

type recordingResolver struct {
	lang   dictionary.Language
	byWord map[string]dictionary.Result
	errs   map[string]error
	calls  []dictionary.Language
}

func (r *recordingResolver) Resolve(_ context.Context, english, _ string, lang dictionary.Language) (dictionary.Result, error) {
	r.calls = append(r.calls, lang)
	r.lang = lang
	if err, ok := r.errs[english]; ok {
		return dictionary.Result{}, err
	}
	if res, ok := r.byWord[english]; ok {
		return res, nil
	}
	return dictionary.Result{English: english, Source: dictionary.SourceMiss}, nil
}

type freeTier struct{}

func (freeTier) IsActiveSubscriber(context.Context, string) (bool, error) { return false, nil }
func (freeTier) TopupBalance(context.Context, string) (int64, error)      { return 0, nil }

type paidTier struct{}

func (paidTier) IsActiveSubscriber(context.Context, string) (bool, error) { return true, nil }
func (paidTier) TopupBalance(context.Context, string) (int64, error)      { return 0, nil }

type unknownTier struct{}

func (unknownTier) IsActiveSubscriber(context.Context, string) (bool, error) {
	return false, errors.New("db down")
}
func (unknownTier) TopupBalance(context.Context, string) (int64, error) { return 0, nil }

func serve(t *testing.T, h *Handler, userID, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if userID != "" {
			c.Set("user_id", userID)
		}
	})
	r.GET("/api/me/review/session", h.Session)
	r.POST("/api/me/review/answers", h.Answer)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	r.ServeHTTP(w, req)
	return w
}

func sessionHandler(svc *fakeService, resolve *recordingResolver, languages stubLanguages, tiers dictionary.QuotaTierSource) *Handler {
	return NewHandler(svc, resolve, languages, tiers)
}

func TestSessionReturnsCardsForAPaidUser(t *testing.T) {
	svc := &fakeService{candidates: []review.Candidate{
		{WordID: "w1", English: "cat"},
		{WordID: "w2", English: "dog"},
	}}
	resolve := &recordingResolver{byWord: map[string]dictionary.Result{
		"cat": {ID: "w1", English: "cat", Chinese: "猫", Pronunciation: "kæt", Source: dictionary.SourceLocal},
		"dog": {ID: "w2", English: "dog", Chinese: "狗", Pronunciation: "dɒg", Source: dictionary.SourceLocal},
	}}
	h := sessionHandler(svc, resolve, stubLanguages{lang: dictionary.LanguageZhHans}, paidTier{})

	w := serve(t, h, "u1", http.MethodGet, "/api/me/review/session", "")

	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body)
	}
	var body struct {
		Cards []cardJSON `json:"cards"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Cards) != 2 || body.Cards[0].WordID != "w1" || body.Cards[0].Chinese != "猫" {
		t.Fatalf("cards %+v", body.Cards)
	}
	if len(resolve.calls) != 2 || resolve.calls[0] != dictionary.LanguageZhHans {
		t.Fatalf("resolve calls %v", resolve.calls)
	}
}

func TestSessionRefusesAFreeUser(t *testing.T) {
	h := sessionHandler(&fakeService{}, &recordingResolver{}, stubLanguages{lang: dictionary.LanguageZhHans}, freeTier{})

	w := serve(t, h, "u1", http.MethodGet, "/api/me/review/session", "")

	if w.Code != http.StatusForbidden {
		t.Fatalf("status %d, want 403", w.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["code"] != "not_entitled" {
		t.Fatalf("body %+v", body)
	}
}

func TestSessionAllowsAnUnknownTier(t *testing.T) {
	svc := &fakeService{}
	h := sessionHandler(svc, &recordingResolver{}, stubLanguages{lang: dictionary.LanguageZhHans}, unknownTier{})

	w := serve(t, h, "u1", http.MethodGet, "/api/me/review/session", "")

	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s, want 200", w.Code, w.Body)
	}
}

func TestSessionSkipsUnresolvedWordsAndUsesTheUsersLanguage(t *testing.T) {
	svc := &fakeService{candidates: []review.Candidate{
		{WordID: "w1", English: "cat"},
		{WordID: "w2", English: "dog"},
	}}
	resolve := &recordingResolver{
		errs: map[string]error{"cat": dictionary.ErrWiktionaryUnavailable},
		byWord: map[string]dictionary.Result{
			"dog": {ID: "w2", English: "dog", Chinese: "狗", Source: dictionary.SourceLocal},
		},
	}
	h := sessionHandler(svc, resolve, stubLanguages{lang: dictionary.LanguageZhHans}, paidTier{})

	w := serve(t, h, "u1", http.MethodGet, "/api/me/review/session", "")

	var body struct {
		Cards []cardJSON `json:"cards"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if w.Code != http.StatusOK || len(body.Cards) != 1 || body.Cards[0].WordID != "w2" || body.Cards[0].Chinese != "狗" {
		t.Fatalf("status %d cards %+v", w.Code, body.Cards)
	}
	if resolve.lang != dictionary.LanguageZhHans {
		t.Fatalf("resolve lang %q, want zh-Hans", resolve.lang)
	}
}

func TestSessionNeverSendsChineseToAnEnglishUser(t *testing.T) {
	cases := []struct {
		name   string
		byWord map[string]dictionary.Result
		errs   map[string]error
	}{
		{
			name: "wiktionary unavailable",
			errs: map[string]error{"cat": dictionary.ErrWiktionaryUnavailable},
		},
		{
			name: "wiktionary english definition without chinese",
			byWord: map[string]dictionary.Result{
				"cat": {
					ID:      "w1",
					English: "cat",
					Source:  dictionary.SourceWiktionary,
					Definition: &dictionary.EnglishDefinition{
						Senses: []dictionary.Sense{{POS: "n", Gloss: "a small domesticated carnivorous mammal"}},
					},
				},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &fakeService{candidates: []review.Candidate{{WordID: "w1", English: "cat"}}}
			resolve := &recordingResolver{byWord: tc.byWord, errs: tc.errs}
			h := sessionHandler(svc, resolve, stubLanguages{lang: dictionary.LanguageEnglish}, paidTier{})

			w := serve(t, h, "u1", http.MethodGet, "/api/me/review/session", "")

			var body struct {
				Cards []cardJSON `json:"cards"`
			}
			_ = json.Unmarshal(w.Body.Bytes(), &body)
			if w.Code != http.StatusOK || len(body.Cards) != 0 {
				t.Fatalf("status %d cards %+v; want empty (no Chinese)", w.Code, body.Cards)
			}
			if resolve.lang != dictionary.LanguageEnglish {
				t.Fatalf("resolve lang %q, want en", resolve.lang)
			}
		})
	}
}

func TestSessionFailsClosedWhenTheExplanationLanguageCannotBeRead(t *testing.T) {
	h := sessionHandler(&fakeService{candidates: []review.Candidate{{WordID: "w1", English: "cat"}}},
		&recordingResolver{}, stubLanguages{err: errors.New("db down")}, paidTier{})

	w := serve(t, h, "u1", http.MethodGet, "/api/me/review/session", "")

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503", w.Code)
	}
}

func TestAnswerReturnsDueForAPaidUser(t *testing.T) {
	due := time.Date(2026, 12, 13, 9, 0, 0, 0, time.UTC)
	svc := &fakeService{due: due}
	h := sessionHandler(svc, &recordingResolver{}, stubLanguages{}, paidTier{})

	w := serve(t, h, "u1", http.MethodPost, "/api/me/review/answers", `{"wordId":"w1","rating":"easy"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["wordId"] != "w1" || body["due"] != "2026-12-13T09:00:00Z" {
		t.Fatalf("body %+v", body)
	}
}

func TestAnswerRefusesAFreeUser(t *testing.T) {
	svc := &fakeService{}
	h := sessionHandler(svc, &recordingResolver{}, stubLanguages{}, freeTier{})

	w := serve(t, h, "u1", http.MethodPost, "/api/me/review/answers", `{"wordId":"w1","rating":"good"}`)

	if w.Code != http.StatusForbidden || len(svc.answered) != 0 {
		t.Fatalf("status %d answered %v, want 403 and none", w.Code, svc.answered)
	}
}

func TestAnswerRejectsABadBodyAndRating(t *testing.T) {
	h := sessionHandler(&fakeService{}, &recordingResolver{}, stubLanguages{}, paidTier{})

	for _, body := range []string{`{}`, `{"wordId":"w1","rating":"medium"}`, `not-json`} {
		w := serve(t, h, "u1", http.MethodPost, "/api/me/review/answers", body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status %d, want 400", body, w.Code)
		}
	}
}

func TestAnswerMapsDomainErrors(t *testing.T) {
	cases := []struct {
		err  error
		code int
		name string
	}{
		{review.ErrNotDue, http.StatusConflict, "not_due"},
		{review.ErrWordGone, http.StatusNotFound, "not_found"},
	}
	for _, tc := range cases {
		svc := &fakeService{answerErr: tc.err}
		h := sessionHandler(svc, &recordingResolver{}, stubLanguages{}, paidTier{})
		w := serve(t, h, "u1", http.MethodPost, "/api/me/review/answers", `{"wordId":"w1","rating":"good"}`)
		var body map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if w.Code != tc.code || body["code"] != tc.name {
			t.Fatalf("%v: status %d body %+v", tc.err, w.Code, body)
		}
	}
}
