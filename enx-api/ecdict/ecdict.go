package ecdict

import (
	"context"
	"enx-api/utils/logger"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	gormlogger "gorm.io/gorm/logger"
)

var (
	db                *gorm.DB
	available         bool
	unavailableReason string
)

const defaultUnavailableReason = "The ECDICT dictionary is not configured or could not be opened. Set ECDICT_DB_PATH and make sure the database file exists."

type stardict struct {
	Word        string `gorm:"column:word"`
	Sw          string `gorm:"column:sw"`
	Phonetic    string `gorm:"column:phonetic"`
	Translation string `gorm:"column:translation"`
	Exchange    string `gorm:"column:exchange"`
}

func (stardict) TableName() string {
	return "stardict"
}

func Init(dbPath string) {
	available = false
	unavailableReason = defaultUnavailableReason
	db = nil

	if dbPath == "" {
		logger.Warn("ECDICT_DB_PATH not set, ECDICT queries will be unavailable")
		return
	}

	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		unavailableReason = fmt.Sprintf("ECDICT database file does not exist: %s", dbPath)
		logger.Warnf("%s", unavailableReason)
		return
	}

	dsn := fmt.Sprintf("file:%s?mode=ro", dbPath)
	var err error
	db, err = gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		unavailableReason = fmt.Sprintf("could not open ECDICT database: %v", err)
		logger.Errorf("%s", unavailableReason)
		return
	}

	available = true
	unavailableReason = ""
	logger.Infof("ECDICT database opened (read-only): %s", dbPath)
}

func IsAvailable() bool {
	return available && db != nil
}

func UnavailableMessage() string {
	if unavailableReason != "" {
		return unavailableReason
	}
	return defaultUnavailableReason
}

// queryTimeout bounds each ECDICT lookup. A word ECDICT doesn't know runs
// every fallback step, and the exchange step scans the whole table (it has
// no index); without a deadline a slow scan could block the request
// indefinitely (observed hanging past Kong's 60s upstream timeout). A var so
// tests can shorten it.
var queryTimeout = 3 * time.Second

var (
	// ErrNotFound: no fallback step matched; ECDICT doesn't know the word.
	ErrNotFound = errors.New("ecdict: word not found")
	// ErrTimeout: the lookup gave up after queryTimeout without an answer.
	ErrTimeout = errors.New("ecdict: lookup timed out")
	// ErrUnavailable: ECDICT is not configured or could not be opened.
	ErrUnavailable = errors.New("ecdict: unavailable")
)

// StardictRow is a raw row of the ECDICT `stardict` table. The admin
// maintenance page (ADR-021) needs every column, unlike enx.Dictionary which
// drops sw/exchange.
type StardictRow struct {
	Word        string `json:"word"`
	Sw          string `json:"sw"`
	Phonetic    string `json:"phonetic"`
	Translation string `json:"translation"`
	Exchange    string `json:"exchange"`
}

type findResult struct {
	entry     stardict
	matchedBy string
	err       error
}

// Find runs the fallback chain -- exact (stardict.word is COLLATE NOCASE, so
// any case) -> sw (strip-word) -> exchange (inflections) -- and reports which
// step matched ("exact", "sw", "exchange"). It returns ErrNotFound when no
// step matches, ErrTimeout after queryTimeout, ErrUnavailable when ECDICT is
// not configured, ctx's error when the caller gave up, and any other
// database error as is: a failure is never reported as "not found". It does
// not meter.
func Find(ctx context.Context, word string) (row StardictRow, matchedBy string, err error) {
	if !IsAvailable() {
		return StardictRow{}, "", ErrUnavailable
	}

	// The lookup goroutine below may outlive this call; it keeps its own
	// handle rather than reading the package-level db later.
	conn := db
	lookupCtx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	// The sqlite driver's context cancellation is best-effort: under
	// concurrent slow scans it has been observed to keep running well past
	// the deadline (17s+ vs. a 3s timeout). Racing the lookup in its own
	// goroutine guarantees we return on time regardless of whether the
	// underlying scan actually stops; the goroutine just finishes on its own
	// later and its result is dropped.
	resultCh := make(chan findResult, 1)
	go func() {
		entry, matchedBy, err := lookupEntry(lookupCtx, conn, word)
		resultCh <- findResult{entry, matchedBy, err}
	}()

	var res findResult
	select {
	case res = <-resultCh:
	case <-lookupCtx.Done():
		res.err = lookupCtx.Err()
	}

	switch {
	case res.err == nil:
		return StardictRow{
			Word:        res.entry.Word,
			Sw:          res.entry.Sw,
			Phonetic:    res.entry.Phonetic,
			Translation: res.entry.Translation,
			Exchange:    res.entry.Exchange,
		}, res.matchedBy, nil
	case errors.Is(res.err, ErrNotFound):
		return StardictRow{}, "", ErrNotFound
	case ctx.Err() != nil:
		// The caller gave up (request canceled or its own deadline).
		return StardictRow{}, "", ctx.Err()
	case errors.Is(res.err, context.DeadlineExceeded):
		logger.Warnf("ECDICT: lookup exceeded %s, giving up: %s", queryTimeout, word)
		return StardictRow{}, "", ErrTimeout
	default:
		logger.Errorf("ECDICT: lookup of %s failed: %v", word, res.err)
		return StardictRow{}, "", res.err
	}
}

// LookupRaw is Find for callers that only need found-or-not (the admin
// maintenance page, ADR-021).
func LookupRaw(ctx context.Context, word string) (row StardictRow, matchedBy string, found bool) {
	row, matchedBy, err := Find(ctx, word)
	return row, matchedBy, err == nil
}

// lookupEntry runs the fallback chain on conn. It returns ErrNotFound when
// nothing matches, and any other error (database, ctx) as is.
func lookupEntry(ctx context.Context, conn *gorm.DB, word string) (stardict, string, error) {
	dbc := conn.WithContext(ctx)
	var entry stardict

	// stardict.word is COLLATE NOCASE: this exact match is already
	// case-insensitive, through the word index. (A LOWER(word) = LOWER(?)
	// step used to follow; it could never match anything this one missed,
	// and it scanned all 3.4M rows.)
	if err := first(dbc.Where("word = ?", word), &entry); err != errMiss {
		return entry, "exact", err
	}

	if sw := stripWord(word); sw != "" {
		if err := first(dbc.Where("sw = ?", sw), &entry); err != errMiss {
			return entry, "sw", err
		}
	}

	// Inflections: the forms are in the unindexed exchange column, so this
	// is a full scan. One scan covers all three patterns; the ORDER BY keeps
	// the earlier one-query-per-pattern precedence (pattern order, then
	// word), so the same headword wins.
	if word != "" {
		p := exchangePatterns(word)
		q := dbc.Where("exchange LIKE ? OR exchange LIKE ? OR exchange LIKE ?", p[0], p[1], p[2]).
			Clauses(clause.OrderBy{Expression: clause.Expr{
				SQL:                "CASE WHEN exchange LIKE ? THEN 0 WHEN exchange LIKE ? THEN 1 ELSE 2 END, word",
				Vars:               []interface{}{p[0], p[1]},
				WithoutParentheses: true,
			}})
		if err := q.Limit(1).Find(&entry); err.Error != nil {
			return stardict{}, "", err.Error
		} else if err.RowsAffected > 0 {
			return entry, "exchange", nil
		}
	}

	return stardict{}, "", ErrNotFound
}

// errMiss marks "this step matched nothing, try the next".
var errMiss = errors.New("no match")

// first fetches one row; gorm's ErrRecordNotFound becomes errMiss, any other
// error (database, ctx) is returned as is.
func first(q *gorm.DB, dest *stardict) error {
	err := q.First(dest).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errMiss
	}
	return err
}

func exchangePatterns(word string) []string {
	return []string{
		"%:" + word + "/%",
		"%/" + word + "/%",
		"%:" + word,
	}
}

func stripWord(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}
