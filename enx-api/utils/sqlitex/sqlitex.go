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
	}
}

func GetDB() *gorm.DB {
	return DB
}
