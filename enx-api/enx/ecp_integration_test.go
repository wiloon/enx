//go:build integration
// +build integration

package enx

import (
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"fmt"
	"testing"
)

func init() {
	logger.Init("CONSOLE", "debug", "rssx-api")
	sqlitex.Init()
}

func TestRemoveDuplcateWord(t *testing.T) {
	fmt.Print("Test00")
	// test data
	word := Word{}
	word.SetEnglish("Kehinde")
	word.Save()
	word.Save()

	word.Translate(1)
	count := word.CountByEnglish()
	if count != 1 {
		t.Errorf("wor count should be 1, actual: %d", count)
	}
}

func TestWordNotExist(t *testing.T) {
	fmt.Print("Test00")
	// test data
	word := Word{}
	word.SetEnglish("wordddd")

	word.Translate(1)
	if word.Id != 0 {
		t.Errorf("inalid word id")
	}
}
