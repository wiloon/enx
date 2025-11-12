package enx

import (
	"testing"
)

// Unit tests - no database required

func TestWordSuffix(t *testing.T) {
	word := Word{}
	word.SetEnglish("DHC-")
	if word.English != "DHC" {
		t.Errorf("test failed")
	}
}

func TestWordVe(t *testing.T) {
	word := Word{}
	word.SetEnglish("we've")
	if word.English != "we've" {
		t.Errorf("test failed")
	}
}
func TestPrefixNonEnglishChar(t *testing.T) {
	word := Word{}
	word.SetEnglish("(Assassins")
	if word.Raw != "Assassins" {
		t.Errorf("test failed")
	}
}
func TestTheyd(t *testing.T) {
	word := Word{}
	word.SetEnglish("They'd")
	if word.English != "They'd" {
		t.Errorf("test failed")
	}
}
