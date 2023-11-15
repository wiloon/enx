package sqlitex

import (
	zapLog "enx-server/utils/logger"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"log"
	"os"
	"runtime"
	"time"
)

var DB *gorm.DB

func Init() {
	var dbPath string
	dbFileName := "enx.db"
	// check if current system is linux or windows
	//goland:noinspection GoBoolExpressions
	if runtime.GOOS == "linux" {
		dbPath = "/var/lib/enx-api/" + dbFileName
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
	DB, err = gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: newLogger,
	})
	if err != nil {
		zapLog.Error("failed to init db: ", dbPath)
	}
}
