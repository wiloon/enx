package metrics

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func newTestRouter(m *Metrics) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(m.Middleware(), gin.Recovery())
	r.GET("/api/word/:word", func(c *gin.Context) {
		c.Set(LookupSourceKey, c.Query("source"))
		c.Status(http.StatusOK)
	})
	r.GET("/api/me", func(c *gin.Context) { c.Status(http.StatusUnauthorized) })
	r.GET("/boom", func(c *gin.Context) { panic("boom") })
	return r
}

func serve(r http.Handler, method, path string) {
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(method, path, nil))
}

func TestMiddlewareCountsByRouteTemplate(t *testing.T) {
	m := New()
	r := newTestRouter(m)

	serve(r, http.MethodGet, "/api/word/serendipity")
	serve(r, http.MethodGet, "/api/word/quixotic")
	serve(r, http.MethodGet, "/api/me")
	serve(r, http.MethodGet, "/no/such/secret-path")

	for _, tc := range []struct {
		route, status string
		want          float64
	}{
		{"/api/word/:word", "200", 2},
		{"/api/me", "401", 1},
		{"unmatched", "404", 1},
	} {
		got := testutil.ToFloat64(m.httpRequests.WithLabelValues(tc.route, "GET", tc.status))
		if got != tc.want {
			t.Errorf("requests{%s,%s} = %v, want %v", tc.route, tc.status, got, tc.want)
		}
	}
	// No label value ever holds a raw path.
	if n := testutil.CollectAndCount(m.httpRequests); n != 3 {
		t.Errorf("request series = %d, want 3", n)
	}
	if n := testutil.CollectAndCount(m.httpDuration); n != 3 {
		t.Errorf("duration series = %d, want 3", n)
	}
}

func TestMiddlewareRecordsPanicsAs500(t *testing.T) {
	m := New()
	serve(newTestRouter(m), http.MethodGet, "/boom")

	if got := testutil.ToFloat64(m.httpRequests.WithLabelValues("/boom", "GET", "500")); got != 1 {
		t.Fatalf("requests{/boom,500} = %v, want 1", got)
	}
}

func TestMiddlewareSkipsPreflight(t *testing.T) {
	m := New()
	serve(newTestRouter(m), http.MethodOptions, "/api/me")

	if n := testutil.CollectAndCount(m.httpRequests); n != 0 {
		t.Fatalf("request series = %d, want 0 for OPTIONS", n)
	}
}

// Only a request that set a lookup source lands in the lookup histogram,
// labelled by that source.
func TestMiddlewareObservesLookupSource(t *testing.T) {
	m := New()
	r := newTestRouter(m)

	serve(r, http.MethodGet, "/api/word/a?source=local")
	serve(r, http.MethodGet, "/api/word/b?source=local")
	serve(r, http.MethodGet, "/api/word/c?source=ecdict")
	serve(r, http.MethodGet, "/api/me")

	if n := testutil.CollectAndCount(m.lookupDuration); n != 2 {
		t.Fatalf("lookup series = %d, want 2 (local, ecdict)", n)
	}
	out := exposition(t, m)
	for _, want := range []string{
		`enx_dictionary_lookup_duration_seconds_count{source="local"} 2`,
		`enx_dictionary_lookup_duration_seconds_count{source="ecdict"} 1`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("exposition lacks %q", want)
		}
	}
}

type timeoutErr struct{}

func (timeoutErr) Error() string { return "i/o timeout" }
func (timeoutErr) Timeout() bool { return true }

func TestObserveAI(t *testing.T) {
	m := New()
	start := time.Now()

	m.ObserveAI("bedrock", "translate_sentence", start, nil, 120, 40)
	m.ObserveAI("bedrock", "translate_sentence", start, errors.New("bad gateway"), 0, 0)
	m.ObserveAI("bedrock", "translate_sentence", start, fmt.Errorf("call: %w", context.DeadlineExceeded), 0, 0)
	m.ObserveAI("bedrock", "rephrase", start, fmt.Errorf("post: %w", timeoutErr{}), 0, 0)

	out := exposition(t, m)
	for _, want := range []string{
		`enx_ai_request_duration_seconds_count{operation="translate_sentence",outcome="ok",provider="bedrock"} 1`,
		`enx_ai_request_duration_seconds_count{operation="translate_sentence",outcome="error",provider="bedrock"} 1`,
		`enx_ai_request_duration_seconds_count{operation="translate_sentence",outcome="timeout",provider="bedrock"} 1`,
		`enx_ai_request_duration_seconds_count{operation="rephrase",outcome="timeout",provider="bedrock"} 1`,
		`enx_ai_tokens_total{direction="input",operation="translate_sentence",provider="bedrock"} 120`,
		`enx_ai_tokens_total{direction="output",operation="translate_sentence",provider="bedrock"} 40`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("exposition lacks %q", want)
		}
	}
}

func TestHandlerExposesRuntimeMetrics(t *testing.T) {
	out := exposition(t, New())
	for _, want := range []string{"go_goroutines", "go_memstats_heap_alloc_bytes"} {
		if !strings.Contains(out, want) {
			t.Errorf("exposition lacks %s", want)
		}
	}
}

func exposition(t *testing.T, m *Metrics) string {
	t.Helper()
	w := httptest.NewRecorder()
	m.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body, _ := io.ReadAll(w.Body)
	return string(body)
}

func TestObserveAuthAndWebhook(t *testing.T) {
	m := New()
	m.ObserveAuth("ok", 3*time.Millisecond)
	m.ObserveAuth("expired", time.Millisecond)
	m.ObserveWebhook("invoice.paid", "ok")
	m.ObserveWebhook("invoice.paid", "error")

	out := exposition(t, m)
	for _, want := range []string{
		`enx_clerk_verify_duration_seconds_count{outcome="ok"} 1`,
		`enx_clerk_verify_duration_seconds_count{outcome="expired"} 1`,
		`enx_stripe_webhook_total{event_type="invoice.paid",outcome="ok"} 1`,
		`enx_stripe_webhook_total{event_type="invoice.paid",outcome="error"} 1`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("exposition lacks %q", want)
		}
	}
}

func TestObserveTrialGrant(t *testing.T) {
	m := New()
	m.ObserveTrialGrant()
	m.ObserveTrialGrant()

	if out := exposition(t, m); !strings.Contains(out, "enx_trial_grants_total 2") {
		t.Errorf("exposition lacks enx_trial_grants_total 2")
	}
}

// A statement that fails because SQLite is busy is counted as a read or a
// write; other errors are not.
func TestInstrumentDBCountsBusyErrors(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	type row struct{ ID int }
	if err := db.AutoMigrate(&row{}); err != nil {
		t.Fatal(err)
	}
	m := New()
	if err := m.InstrumentDB(db); err != nil {
		t.Fatal(err)
	}
	// Stand in for SQLite reporting a locked database.
	busy := errors.New("database is locked (5) (SQLITE_BUSY)")
	inject := func(err error) func(*gorm.DB) {
		return func(tx *gorm.DB) {
			if tx.Statement.Context.Value(injectKey{}) != nil {
				_ = tx.AddError(err)
			}
		}
	}
	_ = db.Callback().Query().Before("gorm:query").Register("test:inject", inject(busy))
	_ = db.Callback().Create().Before("gorm:create").Register("test:inject", inject(busy))
	ctx := context.WithValue(context.Background(), injectKey{}, true)

	db.WithContext(ctx).Find(&[]row{})
	db.WithContext(ctx).Find(&[]row{})
	db.WithContext(ctx).Create(&row{ID: 1})
	db.Find(&[]row{}) // no error: not counted

	out := exposition(t, m)
	for _, want := range []string{
		`enx_sqlite_busy_total{op="read"} 2`,
		`enx_sqlite_busy_total{op="write"} 1`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("exposition lacks %q", want)
		}
	}
}

type injectKey struct{}
