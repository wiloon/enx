package paragraph

import (
	"enx-api/enx"
	"enx-api/utils"
	"enx-api/utils/sqlitex"
	"fmt"
	"testing"
)

func TestParagraph0(t *testing.T) {
	paragraph:= "their 6-year-old to"
	utils.ViperInit()
	sqlitex.Init()
	out := enx.QueryCountInText(paragraph, 1)
	fmt.Printf("out: %+v\n", out)
	// check if key "6-year-old" exist
	if _, ok := out["6-year-old"]; !ok {
		t.Errorf("key \"6-year-old\" not exist")
	}

	if out["6-year-old"].WordType != 1 {
        t.Errorf("invalid word type: %v", out["6-year-old"].WordType)
    }
}

func TestParagraphEndingChar(t *testing.T) {
	paragraph:= "Good morning."
	utils.ViperInit()
	sqlitex.Init()
	out := enx.QueryCountInText(paragraph, 1)
	fmt.Printf("out: %+v\n", out)
	for key, word := range out {
		fmt.Printf("key: %s, word: %+v\n", key, word)
	}
	if _, ok := out["morning"]; !ok {
		t.Errorf("key \"morning\" not exist")
	}

}

func TestParagraphBarcket(t *testing.T) {
	paragraph:= "scientists. (Assassins wove through traffic to attach “sticky bombs” to their car doors.) The"
	utils.ViperInit()
	sqlitex.Init()
	out := enx.QueryCountInText(paragraph, 1)
	fmt.Printf("out: %+v\n", out)
	for key, word := range out {
		fmt.Printf("key: %s, word: %+v\n", key, word)
	}
	if _, ok := out["Assassins"]; !ok {
		t.Errorf("key \"Assassins\" not exist")
	}
	if _, ok := out["doors"]; !ok {
		t.Errorf("key \"Assassins\" not exist")
	}
}
