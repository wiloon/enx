package ecdict

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func TestInitUnavailableWhenPathEmpty(t *testing.T) {
	Init("")
	if IsAvailable() {
		t.Fatal("expected ECDICT unavailable when path is empty")
	}
	if UnavailableMessage() == "" {
		t.Fatal("expected unavailable message")
	}
}

func TestQueryExactThenCaseInsensitive(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "ecdict-test.db")
	createTestDB(t, dbPath)

	Init(dbPath)
	if !IsAvailable() {
		t.Fatal("expected ECDICT available")
	}

	if got := Query("Hello"); got == nil || got.Chinese != "你好" {
		t.Fatalf("exact match failed: %+v", got)
	}
	if got := Query("hello"); got == nil || got.Chinese != "你好" {
		t.Fatalf("case-insensitive match failed: %+v", got)
	}
}

func TestQueryWordFormViaSw(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "ecdict-sw.db")
	createTestDBWithSw(t, dbPath)

	Init(dbPath)
	got := Query("us")
	if got == nil || got.English != "U.S." {
		t.Fatalf("sw lookup failed: %+v", got)
	}
}

func TestQueryWordFormViaExchange(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "ecdict-exchange.db")
	createTestDBWithExchange(t, dbPath)

	Init(dbPath)
	got := Query("running")
	if got == nil || got.English != "run" {
		t.Fatalf("exchange lookup failed: %+v", got)
	}
}

func createTestDB(t *testing.T, dbPath string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE stardict (
		word TEXT PRIMARY KEY,
		sw TEXT,
		phonetic TEXT,
		translation TEXT,
		exchange TEXT
	)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO stardict (word, sw, phonetic, translation, exchange) VALUES (?, ?, ?, ?, ?)`,
		"Hello", "hello", "/həˈloʊ/", "你好", "",
	).Error; err != nil {
		t.Fatal(err)
	}
}

func createTestDBWithSw(t *testing.T, dbPath string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE stardict (
		word TEXT PRIMARY KEY,
		sw TEXT,
		phonetic TEXT,
		translation TEXT,
		exchange TEXT
	)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO stardict (word, sw, phonetic, translation, exchange) VALUES (?, ?, ?, ?, ?)`,
		"U.S.", "us", "", "美国", "",
	).Error; err != nil {
		t.Fatal(err)
	}
}

func createTestDBWithExchange(t *testing.T, dbPath string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE stardict (
		word TEXT PRIMARY KEY,
		sw TEXT,
		phonetic TEXT,
		translation TEXT,
		exchange TEXT
	)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO stardict (word, sw, phonetic, translation, exchange) VALUES (?, ?, ?, ?, ?)`,
		"run", "run", "/rʌn/", "跑", "i:running/p:ran/d:ran",
	).Error; err != nil {
		t.Fatal(err)
	}
}

func TestInitMissingFile(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "no-such-ecdict.db")
	Init(missing)
	if IsAvailable() {
		t.Fatal("expected unavailable for missing file")
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatalf("unexpected stat: %v", err)
	}
}

func TestInitOpensReadOnly(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "ecdict-ro.db")
	createTestDB(t, dbPath)

	Init(dbPath)
	if !IsAvailable() {
		t.Fatal("expected read-only open to succeed")
	}
}
