package enx

import (
	"fmt"
	"testing"
	"enx-server/utils/sqlitex"
)

func TestRemoveDuplcateWord(t *testing.T) {
	fmt.Print("Test00")
	sqlitex.Init()
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
	sqlitex.Init()
	// test data
	word:=Word{}
	word.SetEnglish("wordddd")

	word.Translate()
	if word.Id != 0 {
        t.Errorf("inalid word id")
    }
}
