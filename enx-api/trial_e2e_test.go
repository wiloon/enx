package main

import (
	"net/http"
	"testing"

	"enx-api/utils/sqlitex"

	"github.com/spf13/viper"
)

// ADR-048 end to end: a brand-new account gets the trial at sign-in, can use
// an AI feature on it (spending the trial pool, not a paid one), and is held
// to the trial's daily call limit.
func TestE2E_SignUpTrial(t *testing.T) {
	model := fakeDeepSeek(t, confidentReply)
	for key, value := range map[string]any{
		"sentence-translate.provider":          "deepseek",
		"sentence-translate.deepseek.api-key":  "test-key",
		"sentence-translate.deepseek.base-url": model.URL,
		"stripe.costs.define-word.weight-in":   1,
		"stripe.costs.define-word.weight-out":  3,
		"stripe.costs.define-word.divisor":     3000,
		"credits.trial.calls-per-day":          1,
	} {
		viper.Set(key, value)
		key := key
		t.Cleanup(func() { viper.Set(key, nil) })
	}
	trial := int64(100)
	base, _, token := adminDictEnvWithTrial(t, &trial)
	t.Cleanup(func() {
		sqlitex.DB.Exec("DELETE FROM words WHERE english IN (?, ?)", "rizzler", "zzzword")
		sqlitex.DB.Exec("DELETE FROM credit_accounts")
		sqlitex.DB.Exec("DELETE FROM credit_transactions")
	})

	// The first authenticated request provisions the account and grants the trial.
	code, body := doJSON(t, http.MethodGet, base+"/api/billing/me", token)
	credits, _ := body["credits"].(map[string]any)
	if code != http.StatusOK || credits["trialBalance"] != float64(100) || credits["trialExpiresAt"] == nil {
		t.Fatalf("billing/me: code=%d body=%+v, want trialBalance 100 with an expiry", code, body)
	}

	// The trial unlocks the AI word fallback, and the call is paid from it.
	code, body = doJSONBody(t, http.MethodPost, base+"/api/dictionary/ai-word", token, map[string]string{"word": "rizzler"})
	if code != http.StatusOK || body["found"] != true {
		t.Fatalf("ai-word on the trial: code=%d body=%+v", code, body)
	}
	_, body = doJSON(t, http.MethodGet, base+"/api/billing/me", token)
	credits, _ = body["credits"].(map[string]any)
	if credits["trialBalance"] != float64(99) || credits["topupBalance"] != float64(0) {
		t.Fatalf("after one call: credits=%+v, want trialBalance 99 and topupBalance 0", credits)
	}

	// Over the trial's daily call limit: 429, not billed.
	code, body = doJSONBody(t, http.MethodPost, base+"/api/dictionary/ai-word", token, map[string]string{"word": "zzzword"})
	if code != http.StatusTooManyRequests || body["code"] != "trial_limit_day" {
		t.Fatalf("second call of the day: code=%d body=%+v, want 429 trial_limit_day", code, body)
	}
	_, body = doJSON(t, http.MethodGet, base+"/api/billing/me", token)
	if credits, _ = body["credits"].(map[string]any); credits["trialBalance"] != float64(99) {
		t.Fatalf("a limited call must not be billed: credits=%+v", credits)
	}
}
