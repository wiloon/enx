package ecdict

import (
	"enx-api/enx"
	"enx-api/utils/logger"
	"fmt"
	"os"
	"strings"

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

func Query(words string) *enx.Dictionary {
	if !IsAvailable() {
		return nil
	}

	entry, ok := lookupEntry(words)
	if !ok {
		logger.Debugf("ECDICT: word not found: %s", words)
		return nil
	}

	logger.Debugf("ECDICT hit: %s -> %s", words, entry.Translation)
	return &enx.Dictionary{
		English:       entry.Word,
		Chinese:       entry.Translation,
		Pronunciation: entry.Phonetic,
	}
}

// lookupEntry: exact word → case-insensitive word → sw (strip-word) → exchange (inflections).
func lookupEntry(words string) (stardict, bool) {
	var entry stardict

	if err := db.Where("word = ?", words).First(&entry).Error; err == nil {
		return entry, true
	}
	if err := db.Where("LOWER(word) = LOWER(?)", words).First(&entry).Error; err == nil {
		return entry, true
	}

	sw := stripWord(words)
	if sw != "" {
		if err := db.Where("sw = ?", sw).First(&entry).Error; err == nil {
			return entry, true
		}
	}

	for _, pattern := range exchangePatterns(words) {
		if err := db.Where("exchange LIKE ?", pattern).First(&entry).Error; err == nil {
			return entry, true
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
