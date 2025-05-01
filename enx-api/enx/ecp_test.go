package enx

import (
	"fmt"
	"testing"
	"enx-server/utils/sqlitex"
	"enx-server/utils/logger"
)

func init() {
	logger.Init("CONSOLE", "debug", "rssx-api")
	sqlitex.Init()
}

func TestRemoveDuplcateWord(t *testing.T) {
	fmt.Print("Test00")
	// test data
	word:=Word{}
	word.SetEnglish("Kehinde")
	word.Save()
	word.Save()

	word.Translate()
	count:=word.CountByEnglish()
	if count != 1 {
        t.Errorf("wor count should be 1, actual: %d", count)
    }
}

func TestWordNotExist(t *testing.T) {
	fmt.Print("Test00")
	// test data
	word:=Word{}
	word.SetEnglish("wordddd")

	word.Translate()
	if word.Id != 0 {
        t.Errorf("inalid word id")
    }
}

func TestWordSuffix(t *testing.T) {
	fmt.Print("Test00")
	// test data
	word:=Word{}
	word.SetEnglish("DHC-")
	if word.English != "DHC" {
        t.Errorf("test failed")
    }
}

func TestWordVe(t *testing.T) {
	fmt.Print("Test00")
	// test data
	word:=Word{}
	word.SetEnglish("we've")
	if word.English != "we've" {
        t.Errorf("test failed")
    }
}
func TestPrefixNonEnglishChar(t *testing.T) {
	word:=Word{}
	word.SetEnglish("(Assassins")
	if word.Raw != "Assassins" {
        t.Errorf("test failed")
    }
}
func TestTheyd(t *testing.T) {
	word:=Word{}
	word.SetEnglish("They'd")
	if word.English != "They'd" {
        t.Errorf("test failed")
    }
}