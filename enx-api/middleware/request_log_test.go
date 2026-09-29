package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

type logLine struct {
	msg    string
	fields map[string]interface{}
}

func recordLog(lines *[]logLine) func(string, ...interface{}) {
	return func(msg string, kv ...interface{}) {
		fields := map[string]interface{}{}
		for i := 0; i+1 < len(kv); i += 2 {
			fields[kv[i].(string)] = kv[i+1]
		}
		*lines = append(*lines, logLine{msg, fields})
	}
}

func serveRequestLog(t *testing.T, method, path string) []logLine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	var lines []logLine
	r := gin.New()
	r.Use(RequestLog(recordLog(&lines)))
	r.GET("/api/word/:word", func(c *gin.Context) {
		c.Set("user_id", "u1")
		c.Status(http.StatusTeapot)
	})
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(method, path, nil))
	return lines
}

func TestRequestLogWritesOneStructuredLine(t *testing.T) {
	lines := serveRequestLog(t, http.MethodGet, "/api/word/serendipity")

	if len(lines) != 1 {
		t.Fatalf("got %d lines, want 1", len(lines))
	}
	f := lines[0].fields
	if lines[0].msg != "request" || f["method"] != "GET" || f["status"] != http.StatusTeapot || f["user_id"] != "u1" {
		t.Fatalf("got %+v", lines[0])
	}
	// The route template, never the raw path: the path holds the word the
	// user looked up.
	if f["route"] != "/api/word/:word" {
		t.Fatalf("route = %v, want the template /api/word/:word", f["route"])
	}
	if _, ok := f["duration_ms"].(float64); !ok {
		t.Fatalf("duration_ms = %#v, want a float64", f["duration_ms"])
	}
}

func TestRequestLogLabelsUnmatchedRoutes(t *testing.T) {
	lines := serveRequestLog(t, http.MethodGet, "/nope/secret-path")

	if len(lines) != 1 || lines[0].fields["route"] != "unmatched" || lines[0].fields["status"] != http.StatusNotFound {
		t.Fatalf("got %+v, want one line with route unmatched and status 404", lines)
	}
}

// CORS preflights are answered before any handler and carry no user data;
// logging them would double the volume for nothing.
func TestRequestLogSkipsPreflight(t *testing.T) {
	if lines := serveRequestLog(t, http.MethodOptions, "/api/word/serendipity"); len(lines) != 0 {
		t.Fatalf("got %+v, want no line for OPTIONS", lines)
	}
}
