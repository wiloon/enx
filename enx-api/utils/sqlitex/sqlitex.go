package sqlitex

import (
	zapLog "enx-api/utils/logger"
	"log"
	"os"
	"runtime"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

// Define models for AutoMigrate
// These are minimal struct definitions for table creation
type User struct {
	Id            string    `gorm:"column:id;primaryKey"`
	Name          string    `gorm:"column:name;unique"`
	Email         string    `gorm:"column:email;unique"`
	Password      string    `gorm:"column:password"`
	CreatedAt     time.Time `gorm:"column:created_at"`
	UpdatedAt     time.Time `gorm:"column:updated_at"`
	LastLoginTime time.Time `gorm:"column:last_login_time"`
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
	CreatedAt         int64  `gorm:"column:created_at"`
	UpdatedAt         int64  `gorm:"column:updated_at"`
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

type Youdao struct {
	English string `gorm:"column:english;not null"`
	Result  string `gorm:"column:result;not null"`
	Exist   int    `gorm:"column:exist;not null;default:0"`
}

func (Youdao) TableName() string {
	return "youdao"
}

func Init() {
	var dbPath string
	dbFileName := "enx.db"
	// check if current system is linux or windows
	//goland:noinspection GoBoolExpressions
	if runtime.GOOS == "linux" || runtime.GOOS == "darwin" {
		// Use local path for development, or /var/lib for production
		if _, err := os.Stat("/var/lib/enx-api"); os.IsNotExist(err) {
			// Development: use local path
			dbPath = "./" + dbFileName
		} else {
			// Production: use /var/lib
			dbPath = "/var/lib/enx-api/" + dbFileName
		}
	} else if runtime.GOOS == "windows" {
		dbPath = "C:\\workspace\\apps\\enx\\" + dbFileName
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
	var err error
	zapLog.Infof("opening db: %s", dbPath)
	DB, err = gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: newLogger,
	})
	if err != nil {
		zapLog.Error("failed to init db: ", dbPath)
		return
	}

	// Auto-migrate database schema
	zapLog.Info("running database auto-migration...")
	err = DB.AutoMigrate(&User{}, &Word{}, &UserDict{}, &Session{}, &SyncState{}, &Youdao{})
	if err != nil {
		zapLog.Errorf("failed to auto-migrate database: %v", err)
		return
	}
	zapLog.Info("database auto-migration completed successfully")
}

func GetDB() *gorm.DB {
	return DB
}
