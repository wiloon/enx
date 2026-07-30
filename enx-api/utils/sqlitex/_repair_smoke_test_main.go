package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func main() {
	path := "/tmp/enx-repair-test.db"
	os.Remove(path)
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		panic(err)
	}

	// Simulate production DDL with inline comments
	bad := `CREATE TABLE "words" (
    id TEXT PRIMARY KEY,                    -- UUID instead of auto-increment
    english TEXT NOT NULL,                   -- Original field
    chinese TEXT,                            -- Original field
    pronunciation TEXT,                      -- Original field
    created_at INTEGER,                      -- Unix timestamp
    load_count INTEGER NOT NULL DEFAULT 0,   -- Original field
    updated_at INTEGER NOT NULL,             -- required
    deleted_at INTEGER                       -- Soft delete
)`
	if err := db.Exec(bad).Error; err != nil {
		panic(err)
	}
	if err := db.Exec(`INSERT INTO words VALUES ('a','Hello',NULL,NULL,NULL,1,100,NULL)`).Error; err != nil {
		panic(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_english ON words(english)`).Error; err != nil {
		panic(err)
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

	// Without repair, AutoMigrate should fail
	err = db.AutoMigrate(&Word{})
	fmt.Println("AutoMigrate without repair:", err)

	// Repair
	var createSQL string
	db.Raw(`SELECT sql FROM sqlite_master WHERE type='table' AND name='words'`).Scan(&createSQL)
	if !strings.Contains(createSQL, "--") {
		panic("expected comments")
	}
	err = db.Transaction(func(tx *gorm.DB) error {
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
	if err != nil {
		panic(err)
	}

	db.Raw(`SELECT sql FROM sqlite_master WHERE type='table' AND name='words'`).Scan(&createSQL)
	fmt.Println("comments after repair:", strings.Contains(createSQL, "--"))

	err = db.AutoMigrate(&Word{})
	fmt.Println("AutoMigrate after repair:", err)

	err = db.Exec("CREATE INDEX IF NOT EXISTS idx_words_english_lower ON words(LOWER(english))").Error
	fmt.Println("Create index:", err)

	var names []string
	db.Raw(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='words' ORDER BY name`).Scan(&names)
	fmt.Println("indexes:", names)

	var n int
	db.Raw(`SELECT COUNT(*) FROM words`).Scan(&n)
	fmt.Println("row count:", n)
}
