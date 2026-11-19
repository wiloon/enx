package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"enx-api/config"
	"enx-api/metrics"
	"enx-api/utils/sqlitex"
)

type fakeWordModel struct {
	*httptest.Server
	calls atomic.Int64
}

// fakeDeepSeek stands in for the model: it answers every chat completion with
// one fixed message.
func fakeDeepSeek(t *testing.T, content string) *fakeWordModel {
	t.Helper()
	model := &fakeWordModel{}
	model.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		model.calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		body, _ := json.Marshal(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": content}}},
			"usage":   map[string]any{"prompt_tokens": 150, "completion_tokens": 40, "total_tokens": 190},
		})
		_, _ = w.Write(body)
	}))
	t.Cleanup(model.Close)
	return model
}

// aiWordEnv boots the full server with DeepSeek pointed at a fake model, and
// two users: the "plain" user has top-up credit; the "admin" user has none, so
// it stands in for a user who cannot use AI.
func aiWordEnv(t *testing.T, modelReply string) (base, creditedToken, freeToken, creditedUserID string, model *fakeWordModel) {
	t.Helper()
	model = fakeDeepSeek(t, modelReply)

	cfg := noTrialConfig()
	cfg.Stripe.Costs.DefineWord = config.TokenPrice{WeightIn: 1, WeightOut: 3, Divisor: 3000}
	cfg.SentenceTranslate.Provider = "deepseek"
	cfg.SentenceTranslate.DeepSeek = config.OpenAICompatible{APIKey: "test-key", BaseURL: model.URL}
	base, adminToken, plainToken := adminDictEnvWithConfig(t, cfg)
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM words WHERE english IN (?, ?)", "rizzler", "zzzword")
		sqlitex.DB.Exec("DELETE FROM credit_accounts")
		sqlitex.DB.Exec("DELETE FROM credit_transactions")
		sqlitex.DB.Exec("DELETE FROM subscriptions")
	})

	if code, _ := doJSON(t, http.MethodGet, base+"/api/me", plainToken); code != http.StatusOK {
		t.Fatalf("GET /api/me: code=%d", code)
	}
	if err := sqlitex.DB.Raw("SELECT id FROM users WHERE clerk_user_id = ?", nonAdminSub).Scan(&creditedUserID).Error; err != nil || creditedUserID == "" {
		t.Fatalf("user id = %q, %v", creditedUserID, err)
	}
	if err := sqlitex.DB.Create(&sqlitex.CreditAccount{UserId: creditedUserID, TopupBalance: 25, UpdatedAt: 1}).Error; err != nil {
		t.Fatal(err)
	}
	return base, plainToken, adminToken, creditedUserID, model
}

const confidentReply = `{"is_word": true, "quality": 9, "senses": [{"pos": "n.", "zh": "很有魅力的人"}]}`

func TestE2E_AIWordRecordsAnAttemptWithoutAProvider(t *testing.T) {
	m := metrics.New()
	base, _, token := adminDictEnvServed(t, noTrialConfig(), func(t *testing.T, cfg *config.Config) (*httptest.Server, func()) {
		srv := httptest.NewServer(setupRouter(cfg, m))
		return srv, srv.Close
	})

	code, body := doJSONBody(t, http.MethodPost, base+"/api/dictionary/ai-word", token, map[string]string{"word": "rizzler"})
	if code != http.StatusServiceUnavailable || body["code"] != "ai_unavailable" {
		t.Fatalf("ai-word: code=%d body=%+v, want 503 ai_unavailable", code, body)
	}
	w := httptest.NewRecorder()
	m.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if want := "\nenx_ai_word_fallback_total{outcome=\"failed\"} 1\n"; !strings.Contains(w.Body.String(), want) {
		t.Fatalf("metrics lack exactly one failed AI word attempt")
	}
}

// ADR-045 end to end: a lookup that misses offers the AI fallback, the second
// request defines the word, bills the user, and caches it for everyone with
// AI -- and a user without AI neither gets the fallback nor sees the result.
func TestE2E_AIWordFallback(t *testing.T) {
	base, credited, free, userID, _ := aiWordEnv(t, confidentReply)

	// The first request misses and says what the fallback offers each user.
	code, body := doJSON(t, http.MethodGet, base+"/api/word/rizzler", credited)
	fallback, _ := body["AIFallback"].(map[string]any)
	if code != http.StatusOK || body["Chinese"] != "" || fallback["CanUse"] != true || fallback["Auto"] != false {
		t.Fatalf("credited user's miss: code=%d body=%+v, want CanUse true and Auto false (top-up only is off by default)", code, body)
	}
	code, body = doJSON(t, http.MethodGet, base+"/api/word/rizzler", free)
	fallback, _ = body["AIFallback"].(map[string]any)
	if code != http.StatusOK || fallback["CanUse"] != false || fallback["Auto"] != false {
		t.Fatalf("free user's miss: code=%d body=%+v, want CanUse false", code, body)
	}

	// The second request defines the word.
	code, body = doJSONBody(t, http.MethodPost, base+"/api/dictionary/ai-word", credited, map[string]string{"word": "rizzler"})
	word, _ := body["word"].(map[string]any)
	if code != http.StatusOK || body["found"] != true || word["Chinese"] != "n. 很有魅力的人" || word["Origin"] != "ai" || word["Id"] == "" {
		t.Fatalf("ai-word: code=%d body=%+v", code, body)
	}

	// It was billed by the tokens the call used (150 in, 40 out -> 1 credit).
	var balance int64
	if err := sqlitex.DB.Raw("SELECT topup_balance FROM credit_accounts WHERE user_id = ?", userID).Scan(&balance).Error; err != nil || balance != 24 {
		t.Fatalf("balance = %d, %v, want 24", balance, err)
	}

	// Cached: the credited user's next lookup is an ordinary hit, with no
	// fallback offer, and costs nothing more.
	code, body = doJSON(t, http.MethodGet, base+"/api/word/rizzler", credited)
	if code != http.StatusOK || body["Chinese"] != "n. 很有魅力的人" || body["Origin"] != "ai" || body["AIFallback"] != nil {
		t.Fatalf("cached lookup: code=%d body=%+v", code, body)
	}
	if err := sqlitex.DB.Raw("SELECT topup_balance FROM credit_accounts WHERE user_id = ?", userID).Scan(&balance).Error; err != nil || balance != 24 {
		t.Fatalf("a cache hit must not be billed: balance = %d, %v", balance, err)
	}

	// The user without AI sees none of it, and cannot call the endpoint.
	if _, body = doJSON(t, http.MethodGet, base+"/api/word/rizzler", free); body["Chinese"] != "" {
		t.Fatalf("a user without AI must not see the AI definition: %+v", body)
	}
	if code, body = doJSONBody(t, http.MethodPost, base+"/api/dictionary/ai-word", free, map[string]string{"word": "rizzler"}); code != http.StatusForbidden || body["code"] != "not_entitled" {
		t.Fatalf("free user ai-word: code=%d body=%+v, want 403 not_entitled", code, body)
	}

	// Asking again for a word that is now cached is free and does not reach the model.
	code, body = doJSONBody(t, http.MethodPost, base+"/api/dictionary/ai-word", credited, map[string]string{"word": "rizzler"})
	if word, _ = body["word"].(map[string]any); code != http.StatusOK || word["Chinese"] != "n. 很有魅力的人" {
		t.Fatalf("repeat ai-word: code=%d body=%+v", code, body)
	}
	if err := sqlitex.DB.Raw("SELECT topup_balance FROM credit_accounts WHERE user_id = ?", userID).Scan(&balance).Error; err != nil || balance != 24 {
		t.Fatalf("a repeat request must not be billed: balance = %d, %v", balance, err)
	}
}

const lowQualityReply = `{"is_word": true, "quality": 5, "senses": [{"pos": "n.", "zh": "很有魅力的人"}]}`

// ADR-091 end to end: a definition below ai-word.min-quality is kept as an AI
// candidate definition, so the next ask (this user's or anyone's) is answered
// from it with no model call and no charge; once rejected it answers
// "no definition", and un-rejected it answers again.
func TestE2E_AIWordCandidate(t *testing.T) {
	base, credited, secondToken, userID, model := aiWordEnv(t, lowQualityReply)
	secondUserID := signedInUserID(t, base, secondToken, adminSub)
	if err := sqlitex.DB.Create(&sqlitex.CreditAccount{UserId: secondUserID, TopupBalance: 30, UpdatedAt: 1}).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := sqlitex.DB.Exec("DELETE FROM ai_candidates").Error; err != nil {
			t.Error(err)
		}
	})
	balance := func(id string) int64 {
		t.Helper()
		var account sqlitex.CreditAccount
		if err := sqlitex.DB.Where("user_id = ?", id).First(&account).Error; err != nil {
			t.Fatal(err)
		}
		return account.TopupBalance
	}
	ask := func(token string) (int, map[string]any) {
		return doJSONBody(t, http.MethodPost, base+"/api/dictionary/ai-word", token, map[string]string{"word": "rizzler"})
	}
	setStatus := func(status string) {
		t.Helper()
		result := sqlitex.DB.Exec("UPDATE ai_candidates SET status = ? WHERE english = ?", status, "rizzler")
		if result.Error != nil || result.RowsAffected != 1 {
			t.Fatalf("set status to %q: affected %d rows, err = %v", status, result.RowsAffected, result.Error)
		}
	}

	code, body := ask(credited)
	firstWord, _ := body["word"].(map[string]any)
	if code != http.StatusOK || body["found"] != true || firstWord["Chinese"] != "n. 很有魅力的人" || firstWord["Origin"] != "ai" || firstWord["Id"] != "" {
		t.Fatalf("first ask: code=%d body=%+v, want the definition with no id", code, body)
	}
	if got := balance(userID); got != 24 {
		t.Fatalf("balance = %d, want 24 after one charged call", got)
	}
	var words int64
	if err := sqlitex.DB.Raw("SELECT count(*) FROM words WHERE english = ?", "rizzler").Scan(&words).Error; err != nil {
		t.Fatal(err)
	}
	if words != 0 {
		t.Fatalf("words rows = %d, want none for a candidate", words)
	}

	code, body = ask(secondToken)
	word, _ := body["word"].(map[string]any)
	if code != http.StatusOK || body["found"] != true || word["English"] != firstWord["English"] ||
		word["Chinese"] != firstWord["Chinese"] || word["Origin"] != firstWord["Origin"] || word["Id"] != "" {
		t.Fatalf("second ask: code=%d body=%+v", code, body)
	}
	if got := balance(secondUserID); got != 30 {
		t.Fatalf("second user's balance = %d, want the original 30", got)
	}
	if got := model.calls.Load(); got != 1 {
		t.Fatalf("provider calls after both requests = %d, want 1", got)
	}
	var candidate sqlitex.AICandidate
	if err := sqlitex.DB.Where("english = ?", "rizzler").First(&candidate).Error; err != nil {
		t.Fatal(err)
	}
	if candidate.HitCount != 2 {
		t.Fatalf("hit count = %d, want 2", candidate.HitCount)
	}

	setStatus("rejected")
	code, body = ask(credited)
	if code != http.StatusOK || body["found"] != false || body["reason"] != "no_definition" {
		t.Fatalf("rejected ask: code=%d body=%+v, want found false / no_definition", code, body)
	}
	if got := balance(userID); got != 24 {
		t.Fatalf("a rejected hit must not be charged: balance = %d", got)
	}

	setStatus("pending")
	if code, body = ask(credited); code != http.StatusOK || body["found"] != true {
		t.Fatalf("un-rejected ask: code=%d body=%+v", code, body)
	}
}

// A subscriber's fallback starts by itself; the user can turn that off, and
// the next lookup honours it.
func TestE2E_AIWordFallbackAutoFollowsTheSubscriptionAndThePreference(t *testing.T) {
	base, credited, _, userID, _ := aiWordEnv(t, confidentReply)
	if err := sqlitex.DB.Create(&sqlitex.Subscription{UserId: userID, StripeCustomerId: "cus_ai_word", StripeSubscriptionId: ptrTo("sub_ai_word"), Status: "active", CreatedAt: 1, UpdatedAt: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Exec("UPDATE users SET accepted_subscription_id='sub_ai_word' WHERE id=?", userID).Error; err != nil {
		t.Fatal(err)
	}
	auto := func() any {
		t.Helper()
		code, body := doJSON(t, http.MethodGet, base+"/api/word/zzzword", credited)
		fallback, _ := body["AIFallback"].(map[string]any)
		if code != http.StatusOK || fallback == nil {
			t.Fatalf("lookup: code=%d body=%+v", code, body)
		}
		return fallback["Auto"]
	}

	if auto() != true {
		t.Fatal("a subscriber's AI fallback should start on")
	}
	if code, _ := doJSONBody(t, http.MethodPut, base+"/api/me/preferences", credited, map[string]any{"aiWordFallback": false}); code != http.StatusOK {
		t.Fatalf("turn it off: code=%d", code)
	}
	if auto() != false {
		t.Fatal("after the user turned it off, the lookup must not start AI by itself")
	}
}

func ptrTo(s string) *string { return &s }
