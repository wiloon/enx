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

func TestSetEnglishFieldStripsStraightApostropheS(t *testing.T) {
	word := Word{}
	word.SetEnglishField("dog's")
	if word.English != "dog" {
		t.Errorf("expected English=dog, got %q", word.English)
	}
	if word.Key != "dog" {
		t.Errorf("expected Key=dog, got %q", word.Key)
	}
}

func TestSetEnglishFieldStripsCurlyApostropheS(t *testing.T) {
	word := Word{}
	word.SetEnglishField("dog’s")
	if word.English != "dog" {
		t.Errorf("expected English=dog, got %q", word.English)
	}
	if word.Key != "dog" {
		t.Errorf("expected Key=dog, got %q", word.Key)
	}
}

func TestSetEnglishFieldLowercasesKey(t *testing.T) {
	word := Word{}
	word.SetEnglishField("Morning")
	if word.English != "Morning" {
		t.Errorf("expected English to keep original case, got %q", word.English)
	}
	if word.Key != "morning" {
		t.Errorf("expected Key=morning, got %q", word.Key)
	}
}

func TestSetEnglishTrimsSuffixesAndPrefixes(t *testing.T) {
	cases := []struct {
		raw     string
		english string
	}{
		{"morning.", "morning"},
		{"morning,", "morning"},
		{"(bombs)", "bombs"},
	}
	for _, c := range cases {
		word := Word{}
		word.SetEnglish(c.raw)
		if word.English != c.english {
			t.Errorf("SetEnglish(%q).English = %q, want %q", c.raw, word.English, c.english)
		}
	}
}
