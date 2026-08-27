package sqlitex

import (
	zapLog "enx-api/utils/logger"
	"log"
	"os"
	"path/filepath"
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
	CognitoSub          string    `gorm:"column:cognito_sub;uniqueIndex"`
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
	Id            string  `gorm:"column:id;primaryKey"`
	English       string  `gorm:"column:english;unique;not null"`
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

func Init() {
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
			LogLevel:                  logger.Info, // Log level
			IgnoreRecordNotFoundError: true,        // Ignore ErrRecordNotFound error for logger
			Colorful:                  true,        // Disable color
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

	// Homelab/AWS DBs created by migrations/20251230_migrate_words_to_p2p.sql
	// embed "-- ..." comments inside CREATE TABLE. glebarez/sqlite AutoMigrate
	// rewrites that SQL into <table>__temp and fails ("incomplete input", or
	// "table <t>__temp has no column named 1"), which aborts the whole
	// AutoMigrate call -- so every model listed after the offending one
	// (Subscription, CreditAccount, ...) silently never gets created. Repair
	// the known offenders first.
	if err := repairWordsTableDDLIfNeeded(); err != nil {
		zapLog.Errorf("failed to repair words table DDL: %v", err)
	}
	if err := repairUserDictsTableDDLIfNeeded(); err != nil {
		zapLog.Errorf("failed to repair user_dicts table DDL: %v", err)
	}

	// Auto-migrate database schema
	zapLog.Info("running database auto-migration...")
	err = DB.AutoMigrate(&User{}, &Word{}, &UserDict{}, &Session{}, &SyncState{},
		&Subscription{}, &CreditAccount{}, &CreditTransaction{}, &DictionaryLookupQuota{})
	if err != nil {
		zapLog.Errorf("failed to auto-migrate database: %v", err)
	} else {
		zapLog.Info("database auto-migration completed successfully")
	}

	// Expression index for the case-insensitive fallback lookup in
	// repo.GetWordByEnglish (WHERE LOWER(english) = LOWER(?)). GORM
	// AutoMigrate can't create expression indexes, so it's added here.
	// Mirrored in migrations/006_words_english_lower_index.sql.
	// Run even if AutoMigrate failed so lookups still get the index.
	if err := DB.Exec("CREATE INDEX IF NOT EXISTS idx_words_english_lower ON words(LOWER(english))").Error; err != nil {
		zapLog.Errorf("failed to create idx_words_english_lower: %v", err)
	}

	// One-time data migration: existing users (created before email verification was added)
	// should be treated as already verified, so set their status to 'active'.
	if result := DB.Model(&User{}).Where("status = ''").Update("status", "active"); result.Error != nil {
		zapLog.Errorf("failed to migrate existing user status: %v", result.Error)
	} else if result.RowsAffected > 0 {
		zapLog.Infof("migrated %d existing users to active status", result.RowsAffected)
	}
}

// repairWordsTableDDLIfNeeded rebuilds words without inline "--" comments in
// sqlite_master. Those comments break glebarez AutoMigrate alter-table.
func repairWordsTableDDLIfNeeded() error {
	var createSQL string
	if err := DB.Raw(`SELECT sql FROM sqlite_master WHERE type='table' AND name='words'`).Scan(&createSQL).Error; err != nil {
		return err
	}
	if createSQL == "" || !strings.Contains(createSQL, "--") {
		return nil
	}

	zapLog.Info("repairing words table DDL (strip inline SQL comments for AutoMigrate)")
	return DB.Transaction(func(tx *gorm.DB) error {
		steps := []string{
			`CREATE TABLE words__clean (
				id TEXT PRIMARY KEY,
				english TEXT NOT NULL,
				chinese TEXT,
				pronunciation TEXT,
				created_at INTEGER NOT NULL,
				load_count INTEGER NOT NULL DEFAULT 0,
				updated_at INTEGER NOT NULL,
				deleted_at INTEGER
			)`,
			`INSERT INTO words__clean (id, english, chinese, pronunciation, created_at, load_count, updated_at, deleted_at)
			 SELECT id, english, chinese, pronunciation,
			        COALESCE(created_at, updated_at, 0),
			        COALESCE(load_count, 0),
			        updated_at,
			        deleted_at
			 FROM words`,
			`DROP TABLE words`,
			`ALTER TABLE words__clean RENAME TO words`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_english ON words(english)`,
			`CREATE INDEX IF NOT EXISTS idx_words_updated_at ON words(updated_at)`,
			`CREATE INDEX IF NOT EXISTS idx_words_deleted_at ON words(deleted_at) WHERE deleted_at IS NOT NULL`,
		}
		for _, step := range steps {
			if err := tx.Exec(step).Error; err != nil {
				return err
			}
		}
		return nil
	})
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

func GetDB() *gorm.DB {
	return DB
}
