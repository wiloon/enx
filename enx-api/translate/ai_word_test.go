package translate

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"enx-api/dictionary"

	"github.com/gin-gonic/gin"
)

type fakeAI struct {
	res   dictionary.Result
	err   error
	words []string
}

func (f *fakeAI) DefineWithAI(_ context.Context, english, _ string) (dictionary.Result, error) {
	f.words = append(f.words, english)
	return f.res, f.err
}

type fakePolicy struct{ canUse, auto bool }

func (p fakePolicy) Fallback(context.Context, string) (bool, bool) { return p.canUse, p.auto }

type fakeReviews struct{ recorded []string }

func (r *fakeReviews) RecordWordLookup(_, wordID string) (int, int, error) {
	r.recorded = append(r.recorded, wordID)
	return 3, 0, nil
}

func post(t *testing.T, h gin.HandlerFunc, userID, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/dictionary/ai-word", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if userID != "" {
		c.Set("user_id", userID)
	}
	h(c)
	return w
}

func decode(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v: %s", err, w.Body)
	}
	return body
}

func TestAIWordReturnsTheDefinitionAndRecordsItInTheVocabulary(t *testing.T) {
	ai := &fakeAI{res: dictionary.Result{ID: "w1", English: "rizzler", Chinese: "n. 很有魅力的人", Source: dictionary.SourceAI, Origin: dictionary.OriginAI}}
	reviews := &fakeReviews{}
	h := NewHandler(nil, reviews).WithAI(ai, fakePolicy{})

	w := post(t, h.AIWord, "u1", `{"word":"Rizzler"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	body := decode(t, w)
	word, _ := body["word"].(map[string]any)
	if body["found"] != true || word["Chinese"] != "n. 很有魅力的人" || word["Origin"] != "ai" || word["LoadCount"] != float64(3) {
		t.Fatalf("body = %+v", body)
	}
	if len(reviews.recorded) != 1 || reviews.recorded[0] != "w1" {
		t.Fatalf("review log = %v, want the word recorded", reviews.recorded)
	}
	if len(ai.words) != 1 || ai.words[0] != "Rizzler" {
		t.Fatalf("defined %v, want the word normalised the way a lookup does", ai.words)
	}
}

// A definition the AI was not confident enough to store has no row: it is
// shown, but there is nothing to put in the vocabulary.
func TestAIWordWithoutARowIsNotRecorded(t *testing.T) {
	ai := &fakeAI{res: dictionary.Result{English: "rizzler", Chinese: "n. 很有魅力的人", Source: dictionary.SourceAI, Origin: dictionary.OriginAI}}
	reviews := &fakeReviews{}
	h := NewHandler(nil, reviews).WithAI(ai, fakePolicy{})

	w := post(t, h.AIWord, "u1", `{"word":"rizzler"}`)

	if body := decode(t, w); body["found"] != true {
		t.Fatalf("body = %+v, want the definition shown", body)
	}
	if len(reviews.recorded) != 0 {
		t.Fatalf("review log = %v, want nothing recorded for a word with no row", reviews.recorded)
	}
}

func TestAIWordWhenThereIsNoDefinition(t *testing.T) {
	for _, source := range []dictionary.Source{dictionary.SourceAIMiss, dictionary.SourceTimeout, dictionary.SourceError, dictionary.SourceMiss} {
		ai := &fakeAI{res: dictionary.Result{English: "asdfgh", Source: source}}
		h := NewHandler(nil, &fakeReviews{}).WithAI(ai, fakePolicy{})

		w := post(t, h.AIWord, "u1", `{"word":"asdfgh"}`)

		body := decode(t, w)
		if w.Code != http.StatusOK || body["found"] != false || body["reason"] != "no_definition" || body["word"] != nil {
			t.Errorf("source %q: status %d body %+v, want found false", source, w.Code, body)
		}
	}
}

func TestAIWordErrorMapping(t *testing.T) {
	for _, tc := range []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"invalid word", dictionary.ErrInvalidWord, http.StatusBadRequest, "invalid_word"},
		{"not entitled", dictionary.ErrNotEntitled, http.StatusForbidden, "not_entitled"},
		{"insufficient credit", dictionary.ErrInsufficientCredit, http.StatusPaymentRequired, "insufficient_credit"},
		{"rate limited", dictionary.ErrRateLimited, http.StatusTooManyRequests, "rate_limited"},
		{"trial daily limit", dictionary.ErrTrialLimitedPerDay, http.StatusTooManyRequests, "trial_limit_day"},
		{"trial per-minute limit", dictionary.ErrTrialLimitedPerMinute, http.StatusTooManyRequests, "trial_limit_minute"},
		{"not available", dictionary.ErrAIUnavailable, http.StatusServiceUnavailable, "ai_unavailable"},
		{"model failed", dictionary.ErrAIFailed, http.StatusBadGateway, "ai_failed"},
		{"anything else", errors.New("secret database detail"), http.StatusBadGateway, "ai_failed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := NewHandler(nil, &fakeReviews{}).WithAI(&fakeAI{err: tc.err}, fakePolicy{})

			w := post(t, h.AIWord, "u1", `{"word":"rizzler"}`)

			if w.Code != tc.wantStatus {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.wantStatus, w.Body)
			}
			if got := decode(t, w)["code"]; got != tc.wantCode {
				t.Fatalf("code = %v, want %s", got, tc.wantCode)
			}
			if strings.Contains(w.Body.String(), "secret database detail") {
				t.Fatal("an underlying error leaked to the client")
			}
		})
	}
}

func TestAIWordECDICTUnavailableUsesTheDictionaryNotice(t *testing.T) {
	h := NewHandler(nil, &fakeReviews{}).WithAI(&fakeAI{err: dictionary.ErrEcdictUnavailable}, fakePolicy{})

	if w := post(t, h.AIWord, "u1", `{"word":"rizzler"}`); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503", w.Code)
	}
}

func TestAIWordRejectsBadRequests(t *testing.T) {
	ai := &fakeAI{}
	h := NewHandler(nil, &fakeReviews{}).WithAI(ai, fakePolicy{})

	if w := post(t, h.AIWord, "", `{"word":"rizzler"}`); w.Code != http.StatusUnauthorized {
		t.Errorf("no user: status %d, want 401", w.Code)
	}
	for name, body := range map[string]string{"empty": ``, "not json": `word=rizzler`, "no word": `{}`, "empty word": `{"word":""}`} {
		if w := post(t, h.AIWord, "u1", body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, w.Code)
		}
	}
	if len(ai.words) != 0 {
		t.Fatalf("a bad request reached the AI: %v", ai.words)
	}
}

func TestAIWordIsUnavailableUntilWiredUp(t *testing.T) {
	h := NewHandler(nil, &fakeReviews{})

	if w := post(t, h.AIWord, "u1", `{"word":"rizzler"}`); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503 when the AI fallback is not wired", w.Code)
	}
}

// The lookup that missed tells the client what the fallback offers.
func TestLookupMissOffersTheAIFallback(t *testing.T) {
	for _, tc := range []struct {
		name        string
		policy      AIPolicy
		wantPresent bool
		wantCanUse  bool
		wantAuto    bool
	}{
		{"subscriber", fakePolicy{canUse: true, auto: true}, true, true, true},
		{"top-up only", fakePolicy{canUse: true}, true, true, false},
		{"free user", fakePolicy{}, true, false, false},
		{"fallback not wired", nil, false, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := NewHandler(fakeResolver{res: dictionary.Result{English: "rizzler", Source: dictionary.SourceMiss}}, &fakeReviews{})
			if tc.policy != nil {
				h.WithAI(&fakeAI{}, tc.policy)
			}
			gin.SetMode(gin.TestMode)
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/word/rizzler", nil)
			c.Set("user_id", "u1")
			c.Params = gin.Params{{Key: "word", Value: "rizzler"}}

			h.TranslateByWord(c)

			body := decode(t, w)
			fallback, present := body["AIFallback"].(map[string]any)
			if present != tc.wantPresent {
				t.Fatalf("AIFallback present = %v, want %v: %+v", present, tc.wantPresent, body)
			}
			if present && (fallback["CanUse"] != tc.wantCanUse || fallback["Auto"] != tc.wantAuto) {
				t.Fatalf("AIFallback = %+v, want CanUse=%v Auto=%v", fallback, tc.wantCanUse, tc.wantAuto)
			}
		})
	}
}

func TestLookupHitDoesNotMentionTheAIFallback(t *testing.T) {
	h := NewHandler(fakeResolver{res: dictionary.Result{ID: "w1", English: "run", Chinese: "v. 跑", Source: dictionary.SourceLocal, Origin: dictionary.OriginECDICT}}, &fakeReviews{}).
		WithAI(&fakeAI{}, fakePolicy{canUse: true, auto: true})
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/word/run", nil)
	c.Set("user_id", "u1")
	c.Params = gin.Params{{Key: "word", Value: "run"}}

	h.TranslateByWord(c)

	if body := decode(t, w); body["AIFallback"] != nil || body["Chinese"] != "v. 跑" {
		t.Fatalf("body = %+v, want a plain hit with no fallback offer", body)
	}
}
