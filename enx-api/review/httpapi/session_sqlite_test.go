package httpapi

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"enx-api/dictionary"
	"enx-api/repo"
	"enx-api/review"
	reviewadapters "enx-api/review/adapters"
	"enx-api/utils/sqlitex"

	"github.com/gin-gonic/gin"
)

func setupSessionDB(t *testing.T) {
	t.Helper()
	sqlitex.Init(filepath.Join(t.TempDir(), "review-session.db"))
	gin.SetMode(gin.TestMode)
}

func seedLiveWord(t *testing.T, id, english, chinese string) {
	t.Helper()
	ch, pr := chinese, "pron"
	if err := sqlitex.DB.Create(&sqlitex.Word{
		Id: id, English: english, Chinese: &ch, Pronunciation: &pr, CreatedAt: 1, UpdatedAt: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func fixedClock(at time.Time) func() time.Time { return func() time.Time { return at } }

func productionSessionHandler(t *testing.T, at time.Time, languages stubLanguages, tiers dictionary.QuotaTierSource, resolve Resolver) *Handler {
	t.Helper()
	svc := review.NewService(reviewadapters.NewStore(sqlitex.DB), fixedClock(at))
	return NewHandler(svc, resolve, languages, tiers)
}

func TestSessionIncludesADueLapsedWordAndLeavesCountsAlone(t *testing.T) {
	setupSessionDB(t)
	at := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)
	seedLiveWord(t, "w-lapse", "serendipity", "意外发现")
	seedLiveWord(t, "w-fresh", "cat", "猫")
	if err := sqlitex.DB.Create(&repo.UserDict{
		UserId: "u1", WordId: "w-lapse", QueryCount: 4, Known: false,
		CreatedAt: at.Add(-48 * time.Hour).UnixMilli(), UpdatedAt: at.Add(-48 * time.Hour).UnixMilli(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Create(&repo.UserDict{
		UserId: "u1", WordId: "w-fresh", QueryCount: 1, Known: false,
		CreatedAt: at.UnixMilli(), UpdatedAt: at.UnixMilli(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Create(&sqlitex.ReviewState{
		UserID: "u1", WordID: "w-lapse", Stability: 1, Difficulty: 5, Phase: 2,
		Due: at.Add(-time.Hour).UnixMilli(), LastReview: at.Add(-48 * time.Hour).UnixMilli(),
		Reps: 1, Lapses: 1, LastLapseAt: ptr(at.Add(-48 * time.Hour).UnixMilli()),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Create(&sqlitex.DictionaryQuotaUsage{
		UserID: "u1", UTCDay: at.UTC().Format("2006-01-02"), Used: 7,
	}).Error; err != nil {
		t.Fatal(err)
	}
	resolve := &recordingResolver{byWord: map[string]dictionary.Result{
		"serendipity": {ID: "w-lapse", English: "serendipity", Chinese: "意外发现", Pronunciation: "pron", Source: dictionary.SourceLocal},
		"cat":         {ID: "w-fresh", English: "cat", Chinese: "猫", Pronunciation: "pron", Source: dictionary.SourceLocal},
	}}
	h := productionSessionHandler(t, at, stubLanguages{lang: dictionary.LanguageZhHans}, paidTier{}, resolve)

	w := serve(t, h, "u1", http.MethodGet, "/api/me/review/session", "")

	var body struct {
		Cards []cardJSON `json:"cards"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusOK || len(body.Cards) != 2 || body.Cards[0].WordID != "w-lapse" || body.Cards[1].WordID != "w-fresh" {
		t.Fatalf("status %d cards %+v; want due lapse then fresh", w.Code, body.Cards)
	}
	var ud repo.UserDict
	if err := sqlitex.DB.Where("user_id = ? AND word_id = ?", "u1", "w-lapse").First(&ud).Error; err != nil || ud.QueryCount != 4 {
		t.Fatalf("query count %+v, want 4 unchanged", ud)
	}
	var quota sqlitex.DictionaryQuotaUsage
	if err := sqlitex.DB.Where("user_id = ?", "u1").First(&quota).Error; err != nil || quota.Used != 7 {
		t.Fatalf("quota %+v, want used 7", quota)
	}
}

func TestAnswerThroughTheStoreSchedulesEasyInSixteenDays(t *testing.T) {
	setupSessionDB(t)
	at := time.Date(2026, 11, 27, 9, 0, 0, 0, time.UTC)
	seedLiveWord(t, "w1", "cat", "猫")
	if err := sqlitex.DB.Create(&repo.UserDict{
		UserId: "u1", WordId: "w1", QueryCount: 1, UpdatedAt: at.UnixMilli(), CreatedAt: at.UnixMilli(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	h := productionSessionHandler(t, at, stubLanguages{}, paidTier{}, &recordingResolver{})

	w := serve(t, h, "u1", http.MethodPost, "/api/me/review/answers", `{"wordId":"w1","rating":"easy"}`)

	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	wantDue := at.Add(16 * 24 * time.Hour).UTC().Format(time.RFC3339)
	if w.Code != http.StatusOK || body["due"] != wantDue {
		t.Fatalf("status %d body %+v, want due %s", w.Code, body, wantDue)
	}
	// A second answer while not due is refused and writes no second log.
	w2 := serve(t, h, "u1", http.MethodPost, "/api/me/review/answers", `{"wordId":"w1","rating":"easy"}`)
	var logs int64
	sqlitex.DB.Model(&sqlitex.ReviewLog{}).Count(&logs)
	if w2.Code != http.StatusConflict || logs != 1 {
		t.Fatalf("retry status %d logs %d; want 409 and one log", w2.Code, logs)
	}
}

func ptr[T any](v T) *T { return &v }
