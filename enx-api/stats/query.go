package stats

import (
	"context"
	"errors"
	"fmt"
	"time"

	"enx-api/utils/sqlitex"
)

// SparklineDays is how many days of history Home's mini chart shows.
const SparklineDays = 7

// RecentWordLimit is how many words Home lists under "Recent words".
const RecentWordLimit = 8

// Totals is one bucket of daily_stats columns, summed.
type Totals struct {
	WordsRead            int64 `json:"wordsRead"`
	ArticlesRead         int64 `json:"articlesRead"`
	WordLookups          int64 `json:"wordLookups"`
	NewWords             int64 `json:"newWords"`
	WordsMastered        int64 `json:"wordsMastered"`
	PhraseLookups        int64 `json:"phraseLookups"`
	SentenceTranslations int64 `json:"sentenceTranslations"`
	ContextLookups       int64 `json:"contextLookups"`
}

// Vocab is the current size of the user's word list -- a snapshot of
// user_dicts, not a daily_stats rollup.
type Vocab struct {
	Total    int64 `json:"total"`
	Mastered int64 `json:"mastered"`
}

// RecentWord is one entry of Home's "Recent words".
//
// Ordered by user_dicts.updated_at, which repo.UpsertUserDict bumps on a
// lookup AND on marking a word known -- so this is "words I touched
// recently", not strictly "words I looked up recently". The UI says "Recent
// words" for exactly that reason (ADR-028 Decision 7).
type RecentWord struct {
	English    string `json:"english"`
	Chinese    string `json:"chinese"`
	QueryCount int    `json:"queryCount"`
}

// Point is one plotted bucket. Label is the bucket's first date.
type Point struct {
	Date   string `json:"date"`
	Totals Totals `json:"totals"`
}

// Overview is GET /api/stats/overview: everything Home's first screen needs,
// in one round trip.
type Overview struct {
	Today     Totals       `json:"today"`
	Week      Totals       `json:"week"`
	Sparkline []int64      `json:"sparkline"`
	Vocab     Vocab        `json:"vocab"`
	Recent    []RecentWord `json:"recent"`
}

const sumColumns = `
	COALESCE(SUM(words_read), 0)            AS words_read,
	COALESCE(SUM(articles_read), 0)         AS articles_read,
	COALESCE(SUM(word_lookups), 0)          AS word_lookups,
	COALESCE(SUM(new_words), 0)             AS new_words,
	COALESCE(SUM(words_mastered), 0)        AS words_mastered,
	COALESCE(SUM(phrase_lookups), 0)        AS phrase_lookups,
	COALESCE(SUM(sentence_translations), 0) AS sentence_translations,
	COALESCE(SUM(context_lookups), 0)       AS context_lookups`

// sumRange totals the columns over [from, to] inclusive. An empty range is
// not an error: a user with no rows gets zeros, which is what a new user's
// Home renders from.
func sumRange(ctx context.Context, userID, from, to string) (Totals, error) {
	var t Totals
	err := sqlitex.DB.WithContext(ctx).
		Table("daily_stats").
		Select(sumColumns).
		Where("user_id = ? AND date >= ? AND date <= ?", userID, from, to).
		Scan(&t).Error
	return t, err
}

// weekStart is the Monday on or before d. Weeks start Monday because that is
// what "this week" means to the user this product is for; Sunday-start would
// make Sunday evening's reading land in "next week".
func weekStart(d time.Time) time.Time {
	offset := (int(d.Weekday()) + 6) % 7 // Mon=0 … Sun=6
	return d.AddDate(0, 0, -offset)
}

// GetOverview builds Home's payload for the user's local date.
func GetOverview(ctx context.Context, userID, localDate string, now time.Time) (*Overview, error) {
	day, err := ValidateLocalDate(localDate, now)
	if err != nil {
		return nil, err
	}

	today, err := sumRange(ctx, userID, localDate, localDate)
	if err != nil {
		return nil, err
	}
	week, err := sumRange(ctx, userID, weekStart(day).Format(DateLayout), localDate)
	if err != nil {
		return nil, err
	}
	sparkline, err := getSparkline(ctx, userID, day)
	if err != nil {
		return nil, err
	}
	vocab, err := getVocab(ctx, userID)
	if err != nil {
		return nil, err
	}
	recent, err := getRecentWords(ctx, userID)
	if err != nil {
		return nil, err
	}

	return &Overview{
		Today:     today,
		Week:      week,
		Sparkline: sparkline,
		Vocab:     vocab,
		Recent:    recent,
	}, nil
}

// getSparkline returns exactly SparklineDays words-read values ending on day.
// Missing days are 0, never skipped: a gap-free axis is the whole point --
// dropping the empty days would draw a broken streak as an unbroken one.
func getSparkline(ctx context.Context, userID string, day time.Time) ([]int64, error) {
	start := day.AddDate(0, 0, -(SparklineDays - 1))

	type row struct {
		Date      string
		WordsRead int64
	}
	var rows []row
	if err := sqlitex.DB.WithContext(ctx).
		Table("daily_stats").
		Select("date, words_read").
		Where("user_id = ? AND date >= ? AND date <= ?",
			userID, start.Format(DateLayout), day.Format(DateLayout)).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	byDate := make(map[string]int64, len(rows))
	for _, r := range rows {
		byDate[r.Date] = r.WordsRead
	}

	out := make([]int64, SparklineDays)
	for i := range out {
		out[i] = byDate[start.AddDate(0, 0, i).Format(DateLayout)]
	}
	return out, nil
}

func getVocab(ctx context.Context, userID string) (Vocab, error) {
	var v Vocab
	err := sqlitex.DB.WithContext(ctx).
		Table("user_dicts").
		Select(`COUNT(*) AS total,
		        COALESCE(SUM(CASE WHEN already_acquainted = 1 THEN 1 ELSE 0 END), 0) AS mastered`).
		Where("user_id = ?", userID).
		Scan(&v).Error
	return v, err
}

func getRecentWords(ctx context.Context, userID string) ([]RecentWord, error) {
	var rows []RecentWord
	err := sqlitex.DB.WithContext(ctx).
		Table("user_dicts AS ud").
		Select(`w.english AS english,
		        COALESCE(w.chinese, '') AS chinese,
		        ud.query_count AS query_count`).
		Joins("JOIN words w ON w.id = ud.word_id").
		Where("ud.user_id = ? AND w.deleted_at IS NULL", userID).
		Order("ud.updated_at DESC").
		Limit(RecentWordLimit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	if rows == nil {
		// A new user gets [] rather than null, so the UI can map() blindly.
		rows = []RecentWord{}
	}
	return rows, nil
}

// Period is a series bucket size.
type Period string

const (
	PeriodDay   Period = "day"
	PeriodWeek  Period = "week"
	PeriodMonth Period = "month"
	PeriodYear  Period = "year"
)

// ErrInvalidPeriod is returned for an unknown bucket size.
var ErrInvalidPeriod = errors.New("stats: invalid period")

// MaxSeriesPoints bounds a series response so a wide from/to can't ask the
// server to build an unbounded slice.
const MaxSeriesPoints = 400

func ParsePeriod(s string) (Period, error) {
	switch Period(s) {
	case PeriodDay, PeriodWeek, PeriodMonth, PeriodYear:
		return Period(s), nil
	case "":
		return PeriodDay, nil
	}
	return "", fmt.Errorf("%w: %q", ErrInvalidPeriod, s)
}

// bucketStart snaps d down to the first date of its bucket.
func bucketStart(d time.Time, p Period) time.Time {
	switch p {
	case PeriodWeek:
		return weekStart(d)
	case PeriodMonth:
		return time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, time.UTC)
	case PeriodYear:
		return time.Date(d.Year(), 1, 1, 0, 0, 0, 0, time.UTC)
	default:
		return d
	}
}

func nextBucket(d time.Time, p Period) time.Time {
	switch p {
	case PeriodWeek:
		return d.AddDate(0, 0, 7)
	case PeriodMonth:
		return d.AddDate(0, 1, 0)
	case PeriodYear:
		return d.AddDate(1, 0, 0)
	default:
		return d.AddDate(0, 0, 1)
	}
}

// GetSeries returns one point per bucket between from and to, inclusive,
// with empty buckets zero-filled (same reason as the sparkline).
func GetSeries(ctx context.Context, userID string, p Period, from, to time.Time) ([]Point, error) {
	if to.Before(from) {
		from, to = to, from
	}
	start := bucketStart(from, p)

	// Pull the whole window once and bucket in Go. SQLite can group by a
	// strftime() expression, but not by ISO week, and mixing "some periods
	// grouped in SQL, one in Go" is how the two paths drift apart.
	type row struct {
		Date                 string
		WordsRead            int64
		ArticlesRead         int64
		WordLookups          int64
		NewWords             int64
		WordsMastered        int64
		PhraseLookups        int64
		SentenceTranslations int64
		ContextLookups       int64
	}
	var rows []row
	if err := sqlitex.DB.WithContext(ctx).
		Table("daily_stats").
		Where("user_id = ? AND date >= ? AND date <= ?",
			userID, start.Format(DateLayout), to.Format(DateLayout)).
		Order("date ASC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	points := []Point{}
	idx := map[string]int{}
	for b := start; !b.After(to) && len(points) < MaxSeriesPoints; b = nextBucket(b, p) {
		idx[b.Format(DateLayout)] = len(points)
		points = append(points, Point{Date: b.Format(DateLayout)})
	}
	if len(points) == 0 {
		return points, nil
	}

	for _, r := range rows {
		d, err := time.Parse(DateLayout, r.Date)
		if err != nil {
			continue
		}
		i, ok := idx[bucketStart(d, p).Format(DateLayout)]
		if !ok {
			continue // outside the capped window
		}
		t := &points[i].Totals
		t.WordsRead += r.WordsRead
		t.ArticlesRead += r.ArticlesRead
		t.WordLookups += r.WordLookups
		t.NewWords += r.NewWords
		t.WordsMastered += r.WordsMastered
		t.PhraseLookups += r.PhraseLookups
		t.SentenceTranslations += r.SentenceTranslations
		t.ContextLookups += r.ContextLookups
	}
	return points, nil
}
