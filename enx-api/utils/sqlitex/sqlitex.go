package sqlitex

import (
	zapLog "enx-api/utils/logger"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

// Define models for AutoMigrate
// These are minimal struct definitions for table creation
type User struct {
	Id                  string    `gorm:"column:id;primaryKey"`
	ClerkUserID         string    `gorm:"column:clerk_user_id;uniqueIndex"`
	Name                string    `gorm:"column:name;unique"`
	Email               string    `gorm:"column:email;unique"`
	Password            string    `gorm:"column:password"`
	Status              string    `gorm:"column:status;default:pending"`
	VerificationToken   string    `gorm:"column:verification_token"`
	TokenExpiresAt      time.Time `gorm:"column:token_expires_at"`
	ResetToken          string    `gorm:"column:reset_token"`
	ResetTokenExpiresAt time.Time `gorm:"column:reset_token_expires_at"`
	CreatedAt           time.Time `gorm:"column:created_at"`
	UpdatedAt           time.Time `gorm:"column:updated_at"`
	LastLoginTime       time.Time `gorm:"column:last_login_time"`
}

type Word struct {
	Id string `gorm:"column:id;primaryKey"`
	// COLLATE NOCASE, unique (ADR-043): one row per word whatever its case,
	// the same rule as ECDICT's stardict.word. "english = ?" is therefore
	// case-insensitive and served by idx_words_english.
	English       string  `gorm:"column:english;type:TEXT COLLATE NOCASE;not null;uniqueIndex:idx_words_english"`
	Chinese       *string `gorm:"column:chinese"`
	Pronunciation *string `gorm:"column:pronunciation"`
	CreatedAt     int64   `gorm:"column:created_at;not null"`
	UpdatedAt     int64   `gorm:"column:updated_at;not null"`
	DeletedAt     *int64  `gorm:"column:deleted_at;index:idx_words_deleted_at"`
	LoadCount     int     `gorm:"column:load_count;default:0"`
}

func (Word) TableName() string {
	return "words"
}

type UserDict struct {
	UserId            string `gorm:"column:user_id;primaryKey"`
	WordId            string `gorm:"column:word_id;primaryKey"`
	QueryCount        int    `gorm:"column:query_count;default:0"`
	AlreadyAcquainted int    `gorm:"column:already_acquainted;default:0"`
	CreatedAt         int64  `gorm:"column:created_at;not null"`
	UpdatedAt         int64  `gorm:"column:updated_at;not null"`
}

func (UserDict) TableName() string {
	return "user_dicts"
}

type Session struct {
	ID        string `gorm:"column:id;primaryKey"`
	UserID    string `gorm:"column:user_id"`
	CreatedAt int64  `gorm:"column:created_at"` // Unix milliseconds
	ExpiresAt int64  `gorm:"column:expires_at"` // Unix milliseconds
}

func (Session) TableName() string {
	return "sessions"
}

type SyncState struct {
	PeerAddr     string `gorm:"column:peer_addr;primaryKey"`
	LastSyncTime int64  `gorm:"column:last_sync_time;not null"` // Unix milliseconds
	UpdatedAt    int64  `gorm:"column:updated_at;not null"`     // Unix milliseconds
}

func (SyncState) TableName() string {
	return "sync_state"
}

// Init opens the database with full SQL logging, as tests and tools expect.
func Init() {
	InitWithLogLevel("debug")
}

// InitWithLogLevel opens the database, deriving the SQL log level from the
// application log level (see SQLLogLevel).
func InitWithLogLevel(level string) {
	// Read database path from environment variable or use default
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		// Default path based on OS
		//goland:noinspection GoBoolExpressions
		if runtime.GOOS == "linux" || runtime.GOOS == "darwin" {
			dbPath = "/var/lib/enx-api/enx.db"
		} else if runtime.GOOS == "windows" {
			dbPath = "C:\\workspace\\apps\\enx\\enx.db"
		}
	}
	newLogger := logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags), // io writer
		logger.Config{
			SlowThreshold:             time.Second, // Slow SQL threshold
			LogLevel:                  SQLLogLevel(level),
			IgnoreRecordNotFoundError: true, // Ignore ErrRecordNotFound error for logger
			Colorful:                  true, // Disable color
		},
	)

	// Ensure database directory exists
	dbDir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		zapLog.Errorf("failed to create database directory %s: %v", dbDir, err)
		return
	}

	var err error
	zapLog.Infof("opening db: %s", dbPath)
	// busy_timeout: without it, a writer that finds the file locked by
	// another writer gets SQLITE_BUSY immediately instead of waiting. The
	// credit ledger (billing/credit) relies on concurrent writers queuing
	// rather than failing outright -- see ADR-009 Decision 5's "SQLite
	// 特别说明".
	//
	// _txlock=immediate: a db.Transaction() that reads before it writes
	// (e.g. ledger.ensureAccount's FirstOrCreate before the balance UPDATE)
	// defaults to BEGIN DEFERRED, which takes its read snapshot at the
	// first statement and only grabs the write lock later, at the UPDATE.
	// In WAL mode, if another connection commits a write in between, that
	// upgrade fails with SQLITE_BUSY immediately -- busy_timeout only
	// retries a *blocked* lock wait, not a stale-snapshot upgrade, so it
	// doesn't help here. BEGIN IMMEDIATE grabs the write lock at the start
	// of the transaction instead, turning that failure mode into a normal
	// lock wait that busy_timeout does cover. Verified empirically: without
	// this, ~94% of 300 concurrent ledger writers to the same row failed
	// with SQLITE_BUSY instantly; with it, all queue and succeed.
	dsn := dbPath + "?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(10000)&_txlock=immediate"
	DB, err = gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: newLogger,
	})
	if err != nil {
		zapLog.Errorf("failed to init db: %s, error: %v", dbPath, err)
		return
	}

	// ADR-043: rebuild a case-sensitive words table (clearing words and
	// user_dicts) before AutoMigrate, which can't change a column's
	// collation and mangles the table when it tries.
	if err := migrateWordsEnglishNoCase(); err != nil {
		zapLog.Errorf("failed to migrate words.english to COLLATE NOCASE: %v", err)
	}

	// Homelab/AWS DBs created by migrations/20251230_migrate_words_to_p2p.sql
	// embed "-- ..." comments inside CREATE TABLE. glebarez/sqlite AutoMigrate
	// rewrites that SQL into <table>__temp and fails ("incomplete input", or
	// "table <t>__temp has no column named 1"), which aborts the whole
	// AutoMigrate call -- so every model listed after the offending one
	// (Subscription, CreditAccount, ...) silently never gets created. Repair
	// the known offenders first. (words no longer needs this: the migration
	// above rebuilds any pre-ADR-043 words table, commented or not.)
	if err := repairUserDictsTableDDLIfNeeded(); err != nil {
		zapLog.Errorf("failed to repair user_dicts table DDL: %v", err)
	}

	// Auto-migrate database schema
	zapLog.Info("running database auto-migration...")
	err = DB.AutoMigrate(&User{}, &Word{}, &UserDict{}, &Session{}, &SyncState{},
		&Subscription{}, &CreditAccount{}, &CreditTransaction{}, &DictionaryLookupQuota{},
		&ReaderDocument{}, &DailyStat{}, &StatsIngestLog{}, &PageReport{}, &SavedPage{})
	if err != nil {
		zapLog.Errorf("failed to auto-migrate database: %v", err)
	} else {
		zapLog.Info("database auto-migration completed successfully")
	}

	// One-time data migration: existing users (created before email verification was added)
	// should be treated as already verified, so set their status to 'active'.
	if result := DB.Model(&User{}).Where("status = ''").Update("status", "active"); result.Error != nil {
		zapLog.Errorf("failed to migrate existing user status: %v", result.Error)
	} else if result.RowsAffected > 0 {
		zapLog.Infof("migrated %d existing users to active status", result.RowsAffected)
	}

	// One-time data migration: reader_documents rows created before the
	// updated_at column existed land on its `default:0` (see ReaderDocument)
	// -- backfill them to created_at so they sort correctly in
	// reader.ListDocuments (ORDER BY updated_at DESC) instead of all
	// bunching at the bottom.
	if result := DB.Exec("UPDATE reader_documents SET updated_at = created_at WHERE updated_at = 0"); result.Error != nil {
		zapLog.Errorf("failed to backfill reader_documents.updated_at: %v", result.Error)
	} else if result.RowsAffected > 0 {
		zapLog.Infof("backfilled updated_at for %d existing reader_documents rows", result.RowsAffected)
	}
}

// repairUserDictsTableDDLIfNeeded rebuilds user_dicts without the inline "--"
// field comments its original migration embedded. Same failure mode as
// repairWordsTableDDLIfNeeded: glebarez AutoMigrate mis-parses the commented
// DDL when it rebuilds the table ("table user_dicts__temp has no column named
// 1"), which aborts AutoMigrate before the billing models are reached.
func repairUserDictsTableDDLIfNeeded() error {
	var createSQL string
	if err := DB.Raw(`SELECT sql FROM sqlite_master WHERE type='table' AND name='user_dicts'`).Scan(&createSQL).Error; err != nil {
		return err
	}
	if createSQL == "" || !strings.Contains(createSQL, "--") {
		return nil
	}

	zapLog.Info("repairing user_dicts table DDL (strip inline SQL comments for AutoMigrate)")
	return DB.Transaction(func(tx *gorm.DB) error {
		steps := []string{
			`CREATE TABLE user_dicts__clean (
				user_id TEXT NOT NULL,
				word_id TEXT NOT NULL,
				query_count INTEGER DEFAULT 0,
				already_acquainted INTEGER DEFAULT 0,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (user_id, word_id)
			)`,
			`INSERT INTO user_dicts__clean (user_id, word_id, query_count, already_acquainted, created_at, updated_at)
			 SELECT user_id, word_id,
			        COALESCE(query_count, 0),
			        COALESCE(already_acquainted, 0),
			        COALESCE(created_at, updated_at, 0),
			        COALESCE(updated_at, created_at, 0)
			 FROM user_dicts`,
			`DROP TABLE user_dicts`,
			`ALTER TABLE user_dicts__clean RENAME TO user_dicts`,
			`CREATE INDEX IF NOT EXISTS idx_user_dicts_user_id ON user_dicts(user_id)`,
			`CREATE INDEX IF NOT EXISTS idx_user_dicts_word_id ON user_dicts(word_id)`,
			`CREATE INDEX IF NOT EXISTS idx_user_dicts_updated_at ON user_dicts(updated_at)`,
		}
		for _, step := range steps {
			if err := tx.Exec(step).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// SQLLogLevel maps the application log level to GORM's. Every statement is
// traced only at debug; otherwise GORM reports slow queries and errors.
func SQLLogLevel(level string) logger.LogLevel {
	if strings.EqualFold(strings.TrimSpace(level), "debug") {
		return logger.Info
	}
	return logger.Warn
}

// wordsEnglishNoCase recognises a words table whose english column already
// has ADR-043's COLLATE NOCASE.
var wordsEnglishNoCase = regexp.MustCompile("(?i)`?english`?[^,]*COLLATE NOCASE")

// migrateWordsEnglishNoCase moves a words table from before ADR-043
// (case-sensitive english) to the case-insensitive unique one. SQLite can't
// change a column's collation in place, and case-variant rows ("US", "us")
// would violate the new unique index, so -- as decided in ADR-043 -- it
// clears words and user_dicts (the only table referencing words.id) and
// drops words; AutoMigrate then recreates it from the Word model. Every
// other table is left alone. This only ever touches the application
// database: ECDICT is a separate, read-only file. A fresh database, or one
// already migrated, is left untouched.
func migrateWordsEnglishNoCase() error {
	var ddl string
	if err := DB.Raw(`SELECT sql FROM sqlite_master WHERE type='table' AND name='words'`).Scan(&ddl).Error; err != nil {
		return err
	}
	if ddl == "" || wordsEnglishNoCase.MatchString(ddl) {
		return nil
	}

	var words, reviews int64
	DB.Raw(`SELECT count(*) FROM words`).Scan(&words)
	if DB.Migrator().HasTable("user_dicts") {
		DB.Raw(`SELECT count(*) FROM user_dicts`).Scan(&reviews)
	}
	zapLog.Warnf("ADR-043: rebuilding words with english COLLATE NOCASE; clearing %d words and %d user_dicts rows", words, reviews)

	return DB.Transaction(func(tx *gorm.DB) error {
		if tx.Migrator().HasTable("user_dicts") {
			if err := tx.Exec(`DELETE FROM user_dicts`).Error; err != nil {
				return err
			}
		}
		// Dropping the table drops its indexes, idx_words_english_lower too.
		return tx.Exec(`DROP TABLE words`).Error
	})
}
