package ecdict

import (
	"context"
	"enx-api/enx"
	"enx-api/utils/logger"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

var (
	db                *gorm.DB
	available         bool
	unavailableReason string
)

const defaultUnavailableReason = "ECDICT 词典未配置或无法打开，请设置 ECDICT_DB_PATH 并确保数据库文件存在"

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
		unavailableReason = fmt.Sprintf("ECDICT 数据库文件不存在: %s", dbPath)
		logger.Warnf("%s", unavailableReason)
		return
	}

	dsn := fmt.Sprintf("file:%s?mode=ro", dbPath)
	var err error
	db, err = gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		unavailableReason = fmt.Sprintf("无法打开 ECDICT 数据库: %v", err)
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

// queryTimeout bounds each ECDICT lookup. The stardict table has no index on
// sw/exchange, so the fallback scans below can occasionally take much longer
// than the typical few-millisecond exact-match hit; without a deadline a slow
// scan blocks the request indefinitely (observed hanging past Kong's 60s
// upstream timeout with no way for the handler to recover).
const queryTimeout = 3 * time.Second

type lookupResult struct {
	entry stardict
	ok    bool
}

func Query(ctx context.Context, words string) *enx.Dictionary {
	if !IsAvailable() {
		return nil
	}

	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	// The sqlite driver's context cancellation is best-effort: under
	// concurrent slow scans it has been observed to keep running well past
	// the deadline (17s+ vs. a 3s timeout). Racing the lookup in its own
	// goroutine guarantees Query returns on time regardless of whether the
	// underlying scan actually stops; the goroutine just finishes on its own
	// later and its result is dropped.
	resultCh := make(chan lookupResult, 1)
	go func() {
		entry, ok := lookupEntry(ctx, words)
		resultCh <- lookupResult{entry, ok}
	}()

	select {
	case res := <-resultCh:
		if !res.ok {
			logger.Debugf("ECDICT: word not found: %s", words)
			return nil
		}
		logger.Debugf("ECDICT hit: %s -> %s", words, res.entry.Translation)
		return &enx.Dictionary{
			English:       res.entry.Word,
			Chinese:       res.entry.Translation,
			Pronunciation: res.entry.Phonetic,
		}
	case <-ctx.Done():
		logger.Warnf("ECDICT: query exceeded %s, giving up: %s", queryTimeout, words)
		return nil
	}
}

// lookupEntry: exact word → case-insensitive word → sw (strip-word) → exchange (inflections).
func lookupEntry(ctx context.Context, words string) (stardict, bool) {
	var entry stardict
	dbc := db.WithContext(ctx)

	if err := dbc.Where("word = ?", words).First(&entry).Error; err == nil {
		return entry, true
	}
	if ctx.Err() != nil {
		return stardict{}, false
	}
	if err := dbc.Where("LOWER(word) = LOWER(?)", words).First(&entry).Error; err == nil {
		return entry, true
	}
	if ctx.Err() != nil {
		return stardict{}, false
	}

	sw := stripWord(words)
	if sw != "" {
		if err := dbc.Where("sw = ?", sw).First(&entry).Error; err == nil {
			return entry, true
		}
		if ctx.Err() != nil {
			return stardict{}, false
		}
	}

	for _, pattern := range exchangePatterns(words) {
		if err := dbc.Where("exchange LIKE ?", pattern).First(&entry).Error; err == nil {
			return entry, true
		}
		if ctx.Err() != nil {
			return stardict{}, false
		}
	}

	return stardict{}, false
}

func exchangePatterns(words string) []string {
	if words == "" {
		return nil
	}
	return []string{
		"%:" + words + "/%",
		"%/" + words + "/%",
		"%:" + words,
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
