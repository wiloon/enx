package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"enx-api/config"
	"enx-api/dictionary"
	"enx-api/dictionary/adapters"
	"enx-api/ecdict"
	"enx-api/utils/sqlitex"
)

const (
	anonPath    = "/api/anonymous/dictionary/entry"
	anonDeviceA = "0b5f7c1e-4d0a-4f7e-9b2a-6c1d2e3f4a5b"
	anonDeviceB = "1c6a8d2f-5e1b-4a8f-8c3b-7d2e3f4a5b6c"
)

type anonReply struct {
	status     int
	retryAfter string
	body       map[string]any
}

// sendAnon posts body to the anonymous lookup with no credentials. An empty
// device sends no X-Enx-Device-Id; headers are added as given.
func sendAnon(t *testing.T, base, contentType, device, body string, headers ...string) anonReply {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, base+anonPath, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if device != "" {
		req.Header.Set("X-Enx-Device-Id", device)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	reply := anonReply{status: resp.StatusCode, retryAfter: resp.Header.Get("Retry-After")}
	if err := json.NewDecoder(resp.Body).Decode(&reply.body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return reply
}

func lookupAnon(t *testing.T, base, device, word string, headers ...string) anonReply {
	t.Helper()
	return sendAnon(t, base, "application/json", device, `{"word":"`+word+`"}`, headers...)
}

// perUserRows counts every row of the tables an anonymous lookup must not
// touch.
func perUserRows(t *testing.T) int64 {
	t.Helper()
	var total int64
	for _, table := range []string{"user_dicts", "lookup_events", "daily_stats", "dictionary_quota_usage"} {
		var n int64
		if err := sqlitex.DB.Table(table).Count(&n).Error; err != nil {
			t.Fatalf("%s: %v", table, err)
		}
		total += n
	}
	return total
}

func anonEnv(t *testing.T, edit func(*config.Config)) string {
	t.Helper()
	cfg := noTrialConfig()
	if edit != nil {
		edit(cfg)
	}
	base, _, _ := adminDictEnvWithConfig(t, cfg)
	return base
}

func TestE2E_AnonymousLookupWithoutCredentials(t *testing.T) {
	base := anonEnv(t, nil)
	before := perUserRows(t)

	hello := lookupAnon(t, base, anonDeviceA, "hello")
	if hello.status != http.StatusOK || hello.body["Status"] != "found" || hello.body["Word"] != "hello" ||
		!strings.Contains(hello.body["Chinese"].(string), "你好") || hello.body["Origin"] != "ecdict" {
		t.Fatalf("hello = %d %v, want 200 found with its ECDICT definition", hello.status, hello.body)
	}
	miss := lookupAnon(t, base, anonDeviceA, "zzxqv")
	if _, offered := miss.body["AIFallback"]; miss.status != http.StatusOK || miss.body["Status"] != "not_found" || offered {
		t.Fatalf("zzxqv = %d %v, want 200 not_found with no AI fallback offer", miss.status, miss.body)
	}
	if after := perUserRows(t); after != before {
		t.Fatalf("per-user rows %d -> %d, want no change", before, after)
	}
	// The authenticated routes still need a session.
	if code, _ := doJSON(t, http.MethodGet, base+"/api/me", ""); code != http.StatusUnauthorized {
		t.Fatalf("GET /api/me without a token = %d, want 401", code)
	}
}

func TestE2E_AnonymousLookupHidesUneditedAIDefinitions(t *testing.T) {
	base := anonEnv(t, nil)
	if _, err := (adapters.WordsTable{}).Add(context.Background(), dictionary.Entry{
		English: "rizzler", Chinese: "n. 很有魅力的人", Origin: dictionary.OriginAI, Quality: 9, PromptVersion: "v1",
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlitex.DB.Exec("DELETE FROM words WHERE english = ?", "rizzler") })

	got := lookupAnon(t, base, anonDeviceA, "rizzler")
	if got.status != http.StatusOK || got.body["Status"] != "not_found" {
		t.Fatalf("rizzler = %d %v, want not_found: the AI-made row is not for anonymous lookups", got.status, got.body)
	}
}

func TestE2E_AnonymousLookupFailsWhenECDICTIsUnavailable(t *testing.T) {
	base := anonEnv(t, nil)
	ecdict.Init("")
	got := lookupAnon(t, base, anonDeviceA, "serendipity")
	if got.status != http.StatusOK || got.body["Status"] != "failed" {
		t.Fatalf("serendipity = %d %v, want 200 failed", got.status, got.body)
	}
}

func TestE2E_AnonymousLookupRejectsBadRequests(t *testing.T) {
	base := anonEnv(t, func(cfg *config.Config) { cfg.AnonymousLookup.DeviceDailyLimit = 1 })
	for _, tc := range []struct {
		name, contentType, device, body string
		want                            int
	}{
		{"no device id", "application/json", "", `{"word":"hello"}`, http.StatusBadRequest},
		{"malformed device id", "application/json", "device-1", `{"word":"hello"}`, http.StatusBadRequest},
		{"a sentence", "application/json", anonDeviceA, `{"word":"good morning"}`, http.StatusBadRequest},
		{"no letters", "application/json", anonDeviceA, `{"word":"42"}`, http.StatusBadRequest},
		{"65 characters", "application/json", anonDeviceA, `{"word":"` + strings.Repeat("a", 65) + `"}`, http.StatusBadRequest},
		{"unreadable body", "application/json", anonDeviceA, `{"word":`, http.StatusBadRequest},
		{"not JSON", "text/plain", anonDeviceA, `{"word":"hello"}`, http.StatusUnsupportedMediaType},
		{"no Content-Type", "", anonDeviceA, `{"word":"hello"}`, http.StatusUnsupportedMediaType},
	} {
		if got := sendAnon(t, base, tc.contentType, tc.device, tc.body); got.status != tc.want {
			t.Errorf("%s: %d %v, want %d", tc.name, got.status, got.body, tc.want)
		}
	}
	// None of them counted: the device's one lookup is still there.
	if got := lookupAnon(t, base, anonDeviceA, "hello"); got.status != http.StatusOK {
		t.Fatalf("first served lookup after the refusals: %d %v", got.status, got.body)
	}
}

func TestE2E_AnonymousLookupSwitchedOff(t *testing.T) {
	base := anonEnv(t, func(cfg *config.Config) { cfg.AnonymousLookup.Enabled = false })
	got := sendAnon(t, base, "text/plain", "", "")
	if got.status != http.StatusForbidden || got.body["code"] != "anonymous_lookup_disabled" ||
		got.body["message"] != "Lookups without an account are turned off. Sign in to look up words." {
		t.Fatalf("switched off = %d %v, want 403 anonymous_lookup_disabled before any validation", got.status, got.body)
	}
}

func TestE2E_AnonymousLookupDeviceDailyLimit(t *testing.T) {
	base := anonEnv(t, func(cfg *config.Config) { cfg.AnonymousLookup.DeviceDailyLimit = 2 })
	for i := 0; i < 2; i++ {
		if got := lookupAnon(t, base, anonDeviceA, "hello"); got.status != http.StatusOK {
			t.Fatalf("lookup %d: %d %v", i+1, got.status, got.body)
		}
	}
	got := lookupAnon(t, base, anonDeviceA, "hello")
	if got.status != http.StatusTooManyRequests || got.body["code"] != "anonymous_lookup_limit_exceeded" ||
		got.body["message"] != "You've reached today's limit for lookups without an account. Sign in to keep going." {
		t.Fatalf("third lookup = %d %v, want 429 anonymous_lookup_limit_exceeded", got.status, got.body)
	}
	secs, err := strconv.Atoi(got.retryAfter)
	if now := time.Now().UTC(); err != nil || secs < 1 || secs > 86400 ||
		now.Add(time.Duration(secs)*time.Second).Day() == now.Day() {
		t.Fatalf("Retry-After = %q, want the seconds to the next UTC midnight", got.retryAfter)
	}
	if got := lookupAnon(t, base, anonDeviceB, "hello"); got.status != http.StatusOK {
		t.Fatalf("another device on the same IP: %d %v", got.status, got.body)
	}
	var stored int64
	sqlitex.DB.Table("anonymous_device_usage").Where("device_hash IN ?", []string{anonDeviceA, anonDeviceB}).Count(&stored)
	if stored != 0 {
		t.Fatal("a raw device id reached the database")
	}
}

func TestE2E_AnonymousLookupClientIPFromTheConfiguredHeader(t *testing.T) {
	base := anonEnv(t, func(cfg *config.Config) {
		cfg.AnonymousLookup.ClientIPHeader = "CF-Connecting-IP"
		cfg.AnonymousLookup.IPDailyLimit = 1
	})
	if got := lookupAnon(t, base, anonDeviceA, "hello", "CF-Connecting-IP", "203.0.113.1"); got.status != http.StatusOK {
		t.Fatalf("first from 203.0.113.1: %d %v", got.status, got.body)
	}
	if got := lookupAnon(t, base, anonDeviceB, "hello", "CF-Connecting-IP", "203.0.113.1"); got.status != http.StatusTooManyRequests {
		t.Fatalf("second from 203.0.113.1, another device: %d %v, want 429", got.status, got.body)
	}
	if got := lookupAnon(t, base, anonDeviceB, "hello", "CF-Connecting-IP", "203.0.113.2"); got.status != http.StatusOK {
		t.Fatalf("from 203.0.113.2: %d %v, want its own count", got.status, got.body)
	}
	// Header missing or not an IP: one shared bucket, still limited.
	if got := lookupAnon(t, base, anonDeviceA, "hello"); got.status != http.StatusOK {
		t.Fatalf("first without the header: %d %v", got.status, got.body)
	}
	if got := lookupAnon(t, base, anonDeviceB, "hello", "CF-Connecting-IP", "garbage"); got.status != http.StatusTooManyRequests {
		t.Fatalf("not an IP after a request without the header: %d %v, want the shared bucket's 429", got.status, got.body)
	}
}
