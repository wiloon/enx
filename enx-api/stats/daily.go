// Package stats stores the reading statistics behind enx-ui's Home status
// strip and /stats curves (ADR-028).
//
// Two properties define this package and are easy to break by accident:
//
//  1. It stores day-grained aggregates only -- no URL, host, title, article
//     id or wall-clock timestamp. Which article a user read is a client-side
//     concept that never reaches the server (ADR-028 Decision 4/10).
//  2. Dates are the USER'S LOCAL day, supplied by the client, not UTC. That
//     is deliberate and deliberately different from dictionary_lookup_quota
//     (ADR-029 Decision 6); the two tables' numbers are expected not to match.
package stats

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/spf13/viper"
	"gorm.io/gorm"

	"enx-api/utils/sqlitex"
)

// DateLayout is the wire and storage format for a local date.
const DateLayout = "2006-01-02"

// maxCountPerReport caps every "how many times" metric in a single report.
// A report covers one reading session, so even a pathological session is
// orders of magnitude below this; the cap exists to stop a bug or a hand-
// rolled request from writing a number that would wreck the y-axis forever.
// Words get their own, larger, configurable cap.
const maxCountPerReport = 10000

const (
	defaultMaxWordsPerReport = 50000
	defaultIngestLogTTLDays  = 7
)

// maxLocalDateSkewDays bounds how far a reported local date may sit from the
// server's UTC date. Real UTC offsets span -12h..+14h, so an honest local
// date is never more than one day away; anything further is a broken clock or
// a forged report, and is rejected rather than silently charted.
const maxLocalDateSkewDays = 1

var (
	// ErrInvalidDate is returned for a malformed or implausible local date.
	ErrInvalidDate = errors.New("stats: invalid local date")
	// ErrMissingEventID is returned when the idempotency key is absent.
	ErrMissingEventID = errors.New("stats: missing client event id")
)

// Delta is one session's contribution to a day. Every field is an increment,
// never an absolute value: the client owns the session watermark and reports
// only what it has not reported yet (ADR-028 Options C1).
type Delta struct {
	WordsRead            int64
	ArticlesRead         int64
	WordLookups          int64
	NewWords             int64
	WordsMastered        int64
	PhraseLookups        int64
	SentenceTranslations int64
	ContextLookups       int64
}

// Report is one ingest call.
type Report struct {
	ClientEventID    string
	LocalDate        string
	UTCOffsetMinutes int
	Delta            Delta
}

func maxWordsPerReport() int64 {
	if v := viper.GetInt64("stats.ingest.max-words-per-report"); v > 0 {
		return v
	}
	return defaultMaxWordsPerReport
}

// IngestLogTTL is how long a deduplication row is kept.
func IngestLogTTL() time.Duration {
	days := viper.GetInt("stats.ingest.log-ttl-days")
	if days <= 0 {
		days = defaultIngestLogTTLDays
	}
	return time.Duration(days) * 24 * time.Hour
}

// clamp folds a single metric into [0, max]. Negative deltas are not a
// supported concept -- counters only go up -- so a negative value is a bug on
// the client and is dropped rather than allowed to rewrite history.
func clamp(v, max int64) int64 {
	if v < 0 {
		return 0
	}
	if v > max {
		return max
	}
	return v
}

func (d Delta) clamped() Delta {
	words := maxWordsPerReport()
	return Delta{
		WordsRead:            clamp(d.WordsRead, words),
		ArticlesRead:         clamp(d.ArticlesRead, maxCountPerReport),
		WordLookups:          clamp(d.WordLookups, maxCountPerReport),
		NewWords:             clamp(d.NewWords, maxCountPerReport),
		WordsMastered:        clamp(d.WordsMastered, maxCountPerReport),
		PhraseLookups:        clamp(d.PhraseLookups, maxCountPerReport),
		SentenceTranslations: clamp(d.SentenceTranslations, maxCountPerReport),
		ContextLookups:       clamp(d.ContextLookups, maxCountPerReport),
	}
}

func (d Delta) isEmpty() bool {
	return d == Delta{}
}

// ValidateLocalDate parses date and checks it against now's UTC date.
func ValidateLocalDate(date string, now time.Time) (time.Time, error) {
	parsed, err := time.Parse(DateLayout, date)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: %q", ErrInvalidDate, date)
	}
	today, _ := time.Parse(DateLayout, now.UTC().Format(DateLayout))
	if diff := parsed.Sub(today); diff > maxLocalDateSkewDays*24*time.Hour ||
		diff < -maxLocalDateSkewDays*24*time.Hour {
		return time.Time{}, fmt.Errorf("%w: %q is too far from %s", ErrInvalidDate, date, today.Format(DateLayout))
	}
	return parsed, nil
}

// Ingest applies one report to userID's day, exactly once. applied is false
// when ClientEventID has already been seen, which is the normal outcome of a
// client retry, not an error.
//
// The dedup row and the counter update share one transaction on purpose: if
// they could commit separately, a crash between them would either lose a
// session's data permanently (log written, counters not -- the retry would be
// deduplicated away) or double-count it.
func Ingest(ctx context.Context, userID string, r Report, now time.Time) (applied bool, err error) {
	if userID == "" {
		return false, errors.New("stats: missing user id")
	}
	if r.ClientEventID == "" {
		return false, ErrMissingEventID
	}
	if _, err := ValidateLocalDate(r.LocalDate, now); err != nil {
		return false, err
	}

	delta := r.Delta.clamped()
	if delta.isEmpty() {
		// Nothing to add. Still a success: the client can drop the report.
		return false, nil
	}

	err = sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		logRow := sqlitex.StatsIngestLog{
			ClientEventID: r.ClientEventID,
			UserID:        userID,
			CreatedAt:     now.UnixMilli(),
		}
		res := tx.Exec(
			`INSERT INTO stats_ingest_log (client_event_id, user_id, created_at)
			 VALUES (?, ?, ?) ON CONFLICT(client_event_id) DO NOTHING`,
			logRow.ClientEventID, logRow.UserID, logRow.CreatedAt,
		)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			// Already applied; leave the counters alone.
			return nil
		}

		if err := tx.Exec(
			`INSERT INTO daily_stats (
				user_id, date, utc_offset_minutes,
				words_read, articles_read, word_lookups, new_words, words_mastered,
				phrase_lookups, sentence_translations, context_lookups
			 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(user_id, date) DO UPDATE SET
				utc_offset_minutes    = excluded.utc_offset_minutes,
				words_read            = words_read + excluded.words_read,
				articles_read         = articles_read + excluded.articles_read,
				word_lookups          = word_lookups + excluded.word_lookups,
				new_words             = new_words + excluded.new_words,
				words_mastered        = words_mastered + excluded.words_mastered,
				phrase_lookups        = phrase_lookups + excluded.phrase_lookups,
				sentence_translations = sentence_translations + excluded.sentence_translations,
				context_lookups       = context_lookups + excluded.context_lookups`,
			userID, r.LocalDate, r.UTCOffsetMinutes,
			delta.WordsRead, delta.ArticlesRead, delta.WordLookups, delta.NewWords, delta.WordsMastered,
			delta.PhraseLookups, delta.SentenceTranslations, delta.ContextLookups,
		).Error; err != nil {
			return err
		}
		applied = true
		return nil
	})
	if err != nil {
		return false, err
	}
	return applied, nil
}

// AddLookup records one dictionary lookup on userID's local day. This is the
// server-side L1 counter (ADR-029 Decision 7a): every lookup already passes
// through dictionary.MeterLookup, so counting there makes the numerator of
// "lookups per 1k words" exact and independent of the client's report queue.
// Best-effort by contract -- the caller must never fail a lookup over it.
func AddLookup(ctx context.Context, userID, localDate string, offsetMinutes int) error {
	if userID == "" || localDate == "" {
		return errors.New("stats: missing user id or date")
	}
	return sqlitex.DB.WithContext(ctx).Exec(
		`INSERT INTO daily_stats (user_id, date, utc_offset_minutes, word_lookups)
		 VALUES (?, ?, ?, 1)
		 ON CONFLICT(user_id, date) DO UPDATE SET word_lookups = word_lookups + 1`,
		userID, localDate, offsetMinutes,
	).Error
}

// PurgeIngestLog deletes deduplication rows older than the TTL and returns
// how many went. daily_stats itself is never purged -- it is the user's own
// history and is tiny (one row per day).
func PurgeIngestLog(ctx context.Context, now time.Time) (int64, error) {
	cutoff := now.Add(-IngestLogTTL()).UnixMilli()
	res := sqlitex.DB.WithContext(ctx).
		Where("created_at < ?", cutoff).
		Delete(&sqlitex.StatsIngestLog{})
	return res.RowsAffected, res.Error
}
