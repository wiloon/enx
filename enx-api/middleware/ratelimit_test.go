package middleware

import (
	"encoding/json"
	"enx-api/ratelimit"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type recordedRateLimits struct{ routes []string }

func (r *recordedRateLimits) ObserveRateLimited(route string) {
	r.routes = append(r.routes, route)
}

// rateLimitedRouter mimics apiGroup: something has already put the local
// user id in the context (ClerkAuth), then RateLimit, then the handler.
func rateLimitedRouter(limiter ratelimit.Limiter, obs RateLimitObserver, lines *[]logLine, handled *int) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if lines != nil {
		r.Use(RequestLog(recordLog(lines)))
	}
	r.Use(func(c *gin.Context) {
		if id := c.GetHeader("X-Test-User"); id != "" {
			c.Set("user_id", id)
		}
	})
	r.Use(RateLimit(limiter, obs))
	r.GET("/api/word/:word", func(c *gin.Context) {
		*handled++
		c.Status(http.StatusOK)
	})
	return r
}

func get(r *gin.Engine, user string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/word/serendipity", nil)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	r.ServeHTTP(w, req)
	return w
}

// One token, one more every 2.5s: the second request in a row is refused.
func tightLimiter() ratelimit.Limiter {
	clock := time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)
	return ratelimit.NewMemoryLimiter(ratelimit.Limits{RequestsPerSecond: 0.4, Burst: 1},
		func() time.Time { return clock })
}

func TestRateLimitAnswers429WithRetryAfterAndItsOwnCode(t *testing.T) {
	handled := 0
	r := rateLimitedRouter(tightLimiter(), nil, nil, &handled)

	if w := get(r, "u1"); w.Code != http.StatusOK {
		t.Fatalf("first request: status %d, want 200", w.Code)
	}
	w := get(r, "u1")

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", w.Code)
	}
	if got := w.Header().Get("Retry-After"); got != "3" {
		t.Fatalf("Retry-After = %q, want \"3\"", got)
	}
	var body struct {
		Success bool   `json:"success"`
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	if body.Success || body.Code != "too_many_requests" ||
		body.Message != "Too many requests. Please slow down and try again in a moment." {
		t.Fatalf("body = %+v", body)
	}
	// A refused request never reaches the handler: no quota spent, no lookup
	// counted, no active-user mark (ADR-060 Decision 1).
	if handled != 1 {
		t.Fatalf("handler ran %d times, want 1", handled)
	}
}

func TestRateLimitKeysOnTheLocalUser(t *testing.T) {
	handled := 0
	r := rateLimitedRouter(tightLimiter(), nil, nil, &handled)
	get(r, "u1")

	if w := get(r, "u2"); w.Code != http.StatusOK {
		t.Fatalf("another user's first request: status %d, want 200", w.Code)
	}
}

func TestRateLimitCountsRefusalsByRouteTemplate(t *testing.T) {
	handled := 0
	obs := &recordedRateLimits{}
	r := rateLimitedRouter(tightLimiter(), obs, nil, &handled)
	get(r, "u1")
	get(r, "u1")

	if len(obs.routes) != 1 || obs.routes[0] != "/api/word/:word" {
		t.Fatalf("observed %v, want one refusal on /api/word/:word", obs.routes)
	}
}

func TestRateLimitedRequestIsMarkedOnTheRequestLogLine(t *testing.T) {
	handled := 0
	var lines []logLine
	r := rateLimitedRouter(tightLimiter(), nil, &lines, &handled)
	get(r, "u1")
	get(r, "u1")

	if len(lines) != 2 {
		t.Fatalf("got %d log lines, want 2", len(lines))
	}
	if _, ok := lines[0].fields["rate_limited"]; ok {
		t.Fatalf("allowed request carries rate_limited: %+v", lines[0].fields)
	}
	f := lines[1].fields
	if f["rate_limited"] != true || f["status"] != http.StatusTooManyRequests || f["user_id"] != "u1" {
		t.Fatalf("refused request's line = %+v, want rate_limited=true, 429, u1", f)
	}
}
