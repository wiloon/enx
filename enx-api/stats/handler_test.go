package stats

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func newStatsRouter(userID string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})
	r.POST("/api/stats/ingest", IngestHandler(limits))
	r.GET("/api/stats/overview", OverviewHandler)
	r.GET("/api/stats/series", SeriesHandler)
	return r
}

func serve(t *testing.T, r *gin.Engine, method, target, body string, header http.Header) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	for k, v := range header {
		req.Header[k] = v
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("%s %s: body %q is not JSON: %v", method, target, w.Body.String(), err)
	}
	return w.Code, got
}

func tzHeader(offsetMinutes int) http.Header {
	return http.Header{TZOffsetHeader: {strconv.Itoa(offsetMinutes)}}
}

func todayUTC() string { return time.Now().UTC().Format(DateLayout) }

// offsetOffTheUTCDay is a real UTC offset whose local date differs from the
// UTC date right now, so a test can tell which of the two a handler used.
func offsetOffTheUTCDay() int {
	if time.Now().UTC().Hour() >= 12 {
		return maxOffsetMinutes
	}
	return minOffsetMinutes
}

func TestOffsetFromRequestFallsBackToUTC(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for raw, want := range map[string]int{
		"":     0,
		"480":  480,
		"-300": -300,
		"840":  840,
		"-720": -720,
		"841":  0,
		"-721": 0,
		"+8h":  0,
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
		if raw != "" {
			c.Request.Header.Set(TZOffsetHeader, raw)
		}
		if got := OffsetFromRequest(c); got != want {
			t.Errorf("OffsetFromRequest(%q) = %d, want %d", raw, got, want)
		}
	}
}

func TestLocalDateForCrossesMidnight(t *testing.T) {
	for _, tc := range []struct {
		now    time.Time
		offset int
		want   string
	}{
		{time.Date(2026, 9, 16, 20, 0, 0, 0, time.UTC), 480, "2026-09-17"},
		{time.Date(2026, 9, 16, 2, 0, 0, 0, time.UTC), -300, "2026-09-15"},
		{time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC), 0, "2026-09-16"},
	} {
		if got := LocalDateFor(tc.now, tc.offset); got != tc.want {
			t.Errorf("LocalDateFor(%s, %d) = %s, want %s", tc.now.Format(time.RFC3339), tc.offset, got, tc.want)
		}
	}
}

func TestIngestHandlerRejectsABadReportWith400(t *testing.T) {
	r := newStatsRouter("u-" + t.Name())
	for name, body := range map[string]string{
		"not JSON":         `{`,
		"no event id":      `{"localDate":"` + todayUTC() + `","delta":{"wordsRead":1}}`,
		"implausible date": `{"clientEventId":"e1","localDate":"2000-01-01","delta":{"wordsRead":1}}`,
	} {
		if code, _ := serve(t, r, http.MethodPost, "/api/stats/ingest", body, nil); code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, code)
		}
	}
}

// The extension drops a report from its queue on any 200; applied=false on a
// replay is how it learns the server already counted it.
func TestIngestHandlerAnswersAReplayWith200NotApplied(t *testing.T) {
	user := "u-" + t.Name()
	r := newStatsRouter(user)
	body := `{"clientEventId":"replayed","localDate":"` + todayUTC() + `","delta":{"wordsRead":250,"wordLookups":3}}`

	for i, wantApplied := range []bool{true, false} {
		code, got := serve(t, r, http.MethodPost, "/api/stats/ingest", body, nil)
		if code != http.StatusOK || got["applied"] != wantApplied {
			t.Fatalf("report %d: status %d body %v, want 200 applied=%v", i+1, code, got, wantApplied)
		}
	}
	if got := day(t, user, todayUTC()); got.WordsRead != 250 || got.WordLookups != 3 {
		t.Fatalf("stored day = %+v, want the report counted once", got)
	}
}

func TestOverviewHandlerRejectsAnImplausibleDateWith400(t *testing.T) {
	r := newStatsRouter("u-" + t.Name())
	for _, date := range []string{"not-a-date", "2000-01-01"} {
		if code, _ := serve(t, r, http.MethodGet, "/api/stats/overview?date="+date, "", nil); code != http.StatusBadRequest {
			t.Errorf("date %q: status %d, want 400", date, code)
		}
	}
}

func TestOverviewHandlerUsesTheGivenDate(t *testing.T) {
	user := "u-" + t.Name()
	seedDay(t, user, todayUTC(), 77)

	code, got := serve(t, newStatsRouter(user), http.MethodGet, "/api/stats/overview?date="+todayUTC(), "", nil)
	if code != http.StatusOK {
		t.Fatalf("status %d body %v, want 200", code, got)
	}
	if today := got["today"].(map[string]any); today["wordsRead"] != float64(77) {
		t.Fatalf("today = %v, want wordsRead 77", today)
	}
}

// Without a date the overview is for the caller's local day from the
// timezone header, not the server's UTC day.
func TestOverviewHandlerWithoutADateUsesTheHeadersLocalDay(t *testing.T) {
	user := "u-" + t.Name()
	offset := offsetOffTheUTCDay()
	local := LocalDateFor(time.Now(), offset)
	seedDay(t, user, local, 31)
	seedDay(t, user, todayUTC(), 5)

	code, got := serve(t, newStatsRouter(user), http.MethodGet, "/api/stats/overview", "", tzHeader(offset))
	if code != http.StatusOK {
		t.Fatalf("status %d body %v, want 200", code, got)
	}
	if today := got["today"].(map[string]any); today["wordsRead"] != float64(31) {
		t.Fatalf("today = %v, want the %s total 31", today, local)
	}
}

func TestSeriesHandlerRejectsBadParamsWith400(t *testing.T) {
	r := newStatsRouter("u-" + t.Name())
	for _, query := range []string{"period=hour", "to=2026-13-01", "from=yesterday"} {
		if code, _ := serve(t, r, http.MethodGet, "/api/stats/series?"+query, "", nil); code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", query, code)
		}
	}
}

// With no window the series is the 30 days ending on the caller's local day.
func TestSeriesHandlerDefaultsToThirtyDaysEndingOnTheLocalDay(t *testing.T) {
	user := "u-" + t.Name()
	offset := offsetOffTheUTCDay()
	local := LocalDateFor(time.Now(), offset)
	seedDay(t, user, local, 12)

	code, got := serve(t, newStatsRouter(user), http.MethodGet, "/api/stats/series", "", tzHeader(offset))
	if code != http.StatusOK || got["period"] != "day" {
		t.Fatalf("status %d body %v, want 200 with period day", code, got)
	}
	points := got["points"].([]any)
	if len(points) != 30 {
		t.Fatalf("got %d points, want 30", len(points))
	}
	last := points[29].(map[string]any)
	if last["date"] != local || last["totals"].(map[string]any)["wordsRead"] != float64(12) {
		t.Fatalf("last point = %v, want %s with wordsRead 12", last, local)
	}
}
