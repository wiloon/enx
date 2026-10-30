package sqlitex

import (
	"context"
	"enx-api/ecdict"
	zapLog "enx-api/utils/logger"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
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
	Id          string `gorm:"column:id;primaryKey"`
	ClerkUserID string `gorm:"column:clerk_user_id;uniqueIndex"`
	// Profile attributes, not identity keys: neither is unique (ADR-015,
	// 2026-10-20 note §4). A user is its Clerk user id.
	Name                string    `gorm:"column:name"`
	Email               string    `gorm:"column:email"`
	Password            string    `gorm:"column:password"`
	Status              string    `gorm:"column:status;default:pending"`
	VerificationToken   string    `gorm:"column:verification_token"`
	TokenExpiresAt      time.Time `gorm:"column:token_expires_at"`
	ResetToken          string    `gorm:"column:reset_token"`
	ResetTokenExpiresAt time.Time `gorm:"column:reset_token_expires_at"`
	CreatedAt           time.Time `gorm:"column:created_at"`
	UpdatedAt           time.Time `gorm:"column:updated_at"`
	LastLoginTime       time.Time `gorm:"column:last_login_time"`
	AvatarUrl           string    `gorm:"column:avatar_url"`
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
	// Where the definition first came from: "ecdict" or "ai" (ADR-045). It
	// does not change when an admin edits the row; that is AdminEditedAt.
	Source string `gorm:"column:source;not null;default:ecdict"`
	// Unix milliseconds of the last admin edit; NULL when no admin has
	// changed the row. An AI row is hidden from users who can't use AI
	// until an admin has edited it (ADR-045 Decision 6).
	AdminEditedAt *int64 `gorm:"column:admin_edited_at"`
	// For source "ai" only: the model's own 0-10 confidence in the
	// definition, and the prompt version that produced it, so a better prompt
	// can later re-generate the rows an older one wrote (ADR-045).
	AIQuality       *int    `gorm:"column:ai_quality"`
	AIPromptVersion *string `gorm:"column:ai_prompt_version"`
}

func (Word) TableName() string {
	return "words"
}

type UserDict struct {
	UserId     string `gorm:"column:user_id;primaryKey"`
	WordId     string `gorm:"column:word_id;primaryKey"`
	QueryCount int    `gorm:"column:query_count;default:0"`
	Known      bool   `gorm:"column:known;default:false"`
	CreatedAt  int64  `gorm:"column:created_at;not null"`
	UpdatedAt  int64  `gorm:"column:updated_at;not null"`
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

// Init opens the database at dbPath with full SQL logging, as tests and
// tools expect. It panics when initialisation fails, so no caller carries on
// with a broken database.
func Init(dbPath string) {
	if err := InitWithLogLevel(dbPath, "debug"); err != nil {
		panic(err)
	}
}

// InitWithLogLevel opens the database at dbPath (config db.path), deriving
// the SQL log level from the application log level (see SQLLogLevel), and
// migrates it. An error means the database must not be used: main exits.
func InitWithLogLevel(dbPath, level string) error {
	if err := CheckBillingSchema(dbPath); err != nil {
		return err
	}
	if err := initDatabase(dbPath, level); err != nil {
		return err
	}
	return InitializeBillingSchema(DB)
}

func initDatabase(dbPath, level string) error {
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
		return fmt.Errorf("create database directory %s: %w", dbDir, err)
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
		return fmt.Errorf("open database %s: %w", dbPath, err)
	}

	// ADR-015 (2026-10-20 note §4): users.email and users.name are not
	// unique. A failure here stops startup before AutoMigrate touches users.
	if _, err := rebuildUsersWithoutProfileUniqueness(DB); err != nil {
		return err
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

	// #135: AutoMigrate never renames a column; it would add an empty known
	// next to already_acquainted. So the rename runs first.
	if err := renameUserDictsKnownColumn(); err != nil {
		zapLog.Errorf("failed to rename user_dicts.already_acquainted to known: %v", err)
	}

	// Auto-migrate database schema
	zapLog.Info("running database auto-migration...")
	models := []any{&Word{}, &UserDict{}, &Session{}, &SyncState{}, &LookupEvent{},
		&ReaderDocument{}, &DailyStat{}, &StatsIngestLog{}, &PageReport{}, &SavedPage{},
		&UserPreference{}, &ActiveUsersDay{}, &ReferralCode{}, &Referral{}, &TrialGrant{},
		&User{}, &CreditAccount{}, &CreditTransaction{}}
	err = DB.AutoMigrate(models...)
	if err != nil {
		return fmt.Errorf("auto-migrate database: %w", err)
	}
	zapLog.Info("database auto-migration completed successfully")

	// ADR-059 Decision 5: lookup_events replaced the per-day quota counter.
	// Pre-launch, so its rows are dropped, not migrated.
	if err := DB.Migrator().DropTable("dictionary_lookup_quota"); err != nil {
		zapLog.Errorf("failed to drop dictionary_lookup_quota: %v", err)
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

	if err := cleanCachedEcdictPhonetics(); err != nil {
		zapLog.Errorf("failed to repair cached ECDICT phonetics: %v", err)
	}
	return nil
}

// cleanCachedEcdictPhonetics applies ecdict.CleanPhonetic to the words rows
// cached before that repair existed, which still carry ECDICT's corrupted
// long schwa (`ju:ni'v\\:sәli`). Only rows containing a backslash are read,
// so once they are repaired this is a single query that finds nothing.
func cleanCachedEcdictPhonetics() error {
	var rows []Word
	if err := DB.Select("id", "pronunciation").
		Where("instr(pronunciation, ?) > 0", `\`).Find(&rows).Error; err != nil {
		return err
	}
	fixed := 0
	for _, w := range rows {
		clean := ecdict.CleanPhonetic(*w.Pronunciation)
		if clean == *w.Pronunciation {
			continue
		}
		if err := DB.Model(&Word{}).Where("id = ?", w.Id).
			UpdateColumn("pronunciation", clean).Error; err != nil {
			return err
		}
		fixed++
	}
	if fixed > 0 {
		zapLog.Infof("repaired the ECDICT phonetic of %d cached words", fixed)
	}
	return nil
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
				known INTEGER DEFAULT 0,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (user_id, word_id)
			)`,
			`INSERT INTO user_dicts__clean (user_id, word_id, query_count, known, created_at, updated_at)
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

// renameUserDictsKnownColumn renames user_dicts.already_acquainted to known
// in place (#135). The 0/1 values stay as they are: GORM reads them as a bool.
// A fresh database, or one already renamed, is left untouched.
func renameUserDictsKnownColumn() error {
	if !DB.Migrator().HasColumn("user_dicts", "already_acquainted") {
		return nil
	}
	zapLog.Info("renaming user_dicts.already_acquainted to known")
	return DB.Exec(`ALTER TABLE user_dicts RENAME COLUMN already_acquainted TO known`).Error
}

// WithoutLoggedValues returns db whose SQL log shows its statements with `?`
// in place of every bound value, for writes of personal data such as a
// user's email, name or avatar URL.
func WithoutLoggedValues(db *gorm.DB) *gorm.DB {
	return db.Session(&gorm.Session{Logger: valuesHidden{db.Logger}})
}

type valuesHidden struct{ logger.Interface }

func (l valuesHidden) LogMode(level logger.LogLevel) logger.Interface {
	return valuesHidden{l.Interface.LogMode(level)}
}

func (valuesHidden) ParamsFilter(_ context.Context, sql string, _ ...interface{}) (string, []interface{}) {
	return sql, nil
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

// CheckBillingSchema inspects an existing database read-only before startup writes.
func CheckBillingSchema(path string) error {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	u := url.URL{Scheme: "file", Path: abs, RawQuery: "mode=ro"}
	db, err := gorm.Open(sqlite.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return fmt.Errorf("inspect billing schema: %w", err)
	}
	raw, err := db.DB()
	if err != nil {
		return err
	}
	defer raw.Close()

	var tables int64
	if err := db.Raw("SELECT count(*) FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&tables).Error; err != nil {
		return err
	}
	if tables == 0 {
		return nil
	}
	unsupported := func(reason string) error {
		return fmt.Errorf("unsupported billing schema: %s; initialize a fresh database or deploy a compatible binary", reason)
	}
	for _, version := range billingMigrationVersions {
		done, err := migrationApplied(db, version)
		if err != nil {
			return unsupported(err.Error())
		}
		if !done {
			return unsupported("missing version " + version)
		}
	}
	var versions []string
	if err := db.Raw("SELECT version FROM schema_migrations").Scan(&versions).Error; err != nil {
		return unsupported(err.Error())
	}
	for _, version := range versions {
		known := version == "297-legacy-provenance-backfill-v1"
		for _, supported := range billingMigrationVersions {
			known = known || version == supported
		}
		if !known {
			return unsupported("unknown version " + version)
		}
	}
	required := map[string]string{
		"users":                     "id,accepted_subscription_id,billing_version",
		"subscriptions":             "stripe_subscription_id,user_id,stripe_customer_id,status,plan,price_id,current_period_end,cancel_at_period_end,cancel_at,pending_update,has_schedule,classification,version,conflict_reason,conflict_with_subscription_id,conflict_discovered_at,conflict_status,conflict_resolver_id,conflict_resolved_at,conflict_notes,support_message,support_at,conflict_alert_state,support_alert_state,created_at,updated_at",
		"stripe_customers":          "stripe_customer_id,user_id,created_at",
		"credit_accounts":           "user_id,pool_grant_id,subscription_balance,topup_balance,period_end",
		"credit_transactions":       "id,user_id,grant_kind,stripe_invoice_id,stripe_subscription_id,period_start,period_end,from_tier,tier,purchased,applied,without_period,provenance_reason",
		"stripe_webhook_deliveries": "id,received_at,stripe_account_id,livemode,event_id,event_type,event_created,api_version,payload",
		"stripe_webhook_events":     "stripe_account_id,livemode,event_id,type,created,api_version,first_delivery_id,first_received_at,subscription_id,customer_id,checkout_session_id,invoice_id,payment_intent_id,charge_id,status,attempts,last_error,first_wait_at,next_attempt_at,completed_at,claim_token,claim_expires_at,alert_state,updated_at",
		"account_deletion_gates":    "user_id,state,started_at,deleted_at,updated_at",
		"account_deletion_attempts": "user_id,owner,lease_until,phase,reset_trial",
	}
	for table, columns := range required {
		rows, err := db.Raw("SELECT " + columns + " FROM " + table + " LIMIT 0").Rows()
		if err != nil {
			return unsupported(table + ": " + err.Error())
		}
		if err := rows.Close(); err != nil {
			return err
		}
	}
	cols, err := tableColumns(db, "subscriptions")
	if err != nil {
		return err
	}
	var pk []string
	for _, c := range cols {
		if c.Pk > 0 {
			pk = append(pk, strings.ToLower(c.Name))
		}
	}
	if len(pk) != 1 || pk[0] != "stripe_subscription_id" {
		return unsupported("subscriptions must be keyed by Stripe Subscription ID")
	}
	for _, index := range []string{"idx_credit_transactions_subscription_invoice", "idx_credit_transactions_subscription_period"} {
		if !db.Migrator().HasIndex("credit_transactions", index) {
			return unsupported("missing index " + index)
		}
	}
	return nil
}
