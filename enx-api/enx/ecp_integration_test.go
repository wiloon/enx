//go:build integration
// +build integration

package enx

import (
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"path/filepath"
	"testing"
)

func init() {
	logger.Init("CONSOLE", "debug", "rssx-api")
}

// setupIntegrationDB points sqlitex.DB at a fresh file DB built by the real
// sqlitex.Init() migration. It must run inside each test: other tests in this
// package swap the global sqlitex.DB for in-memory DBs, so a DB opened once in
// init() is not the one these tests end up using.
func setupIntegrationDB(t *testing.T) {
	t.Helper()
	t.Setenv("DB_PATH", filepath.Join(t.TempDir(), "enx.db"))
	sqlitex.Init()
}

func TestSaveDuplicateEnglish_UniqueConstraintPreventsDuplicate(t *testing.T) {
	setupIntegrationDB(t)
	word := Word{}
	word.SetEnglish("Kehinde")
	if err := word.Save(); err != nil {
		t.Fatalf("first Save: %v", err)
	}
	dup := Word{}
	dup.SetEnglish("Kehinde")
	if err := dup.Save(); err == nil {
		t.Error("second Save should fail on the unique constraint")
	}

	word.Translate("1")
	count := word.CountByEnglish()
	if count != 1 {
		t.Errorf("word count should be 1, actual: %d", count)
	}
}

func TestWordNotExist(t *testing.T) {
	setupIntegrationDB(t)
	word := Word{}
	word.SetEnglish("wordddd")

	word.Translate("1")
	if word.Id != "" {
		t.Errorf("invalid word id")
	}
}
