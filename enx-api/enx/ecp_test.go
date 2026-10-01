package enx

import (
	"enx-api/repo"
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

// ADR-043: the lookup key uses straight apostrophes; Raw keeps the page's
// spelling, because the extension keys its cache on it.
func TestSetEnglishStraightensApostrophes(t *testing.T) {
	for raw, want := range map[string][2]string{
		"don’t": {"don't", "don’t"},
		"Tom’s": {"Tom", "Tom’s"},
		"don't": {"don't", "don't"},
	} {
		w := Word{}
		w.SetEnglish(raw)
		if w.English != want[0] || w.Raw != want[1] {
			t.Errorf("SetEnglish(%q): English=%q Raw=%q, want %q / %q", raw, w.English, w.Raw, want[0], want[1])
		}
	}
}

func TestWordSaveStoresCanonicalEnglish(t *testing.T) {
	db := newEcpTestDB(t)
	w := Word{English: "won’t"}
	if err := w.Save(); err != nil {
		t.Fatal(err)
	}
	var stored repo.Word
	if err := db.Where("id = ?", w.Id).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.English != "won't" {
		t.Fatalf("stored english %q, want won't", stored.English)
	}
}
