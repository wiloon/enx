package enx

import (
	"testing"
	"time"

	"enx-api/repo"
)

func TestWordsInDigitLeadingToken(t *testing.T) {
	newEcpTestDB(t)

	out := wordsIn(t, "6-year-old", "u1")
	got, ok := out["6-year-old"]
	if !ok {
		t.Fatal(`expected key "6-year-old" to be present`)
	}
	if got.WordType != 1 {
		t.Errorf("WordType = %d, want 1 for a digit-leading token", got.WordType)
	}
}

func TestWordsInWordNotInDB(t *testing.T) {
	newEcpTestDB(t)

	out := wordsIn(t, "morning", "u1")
	got, ok := out["morning"]
	if !ok {
		t.Fatal(`expected key "morning" to be present`)
	}
	if got.LoadCount != 0 || got.Known {
		t.Errorf("expected a fresh word to have LoadCount=0 Known=false, got %+v", got)
	}
}

func TestWordsInWordWithExistingUserDict(t *testing.T) {
	db := newEcpTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&repo.Word{Id: "id-morning", English: "morning", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&repo.UserDict{UserId: "u1", WordId: "id-morning", QueryCount: 2, Known: true, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	out := wordsIn(t, "morning", "u1")
	got, ok := out["morning"]
	if !ok {
		t.Fatal(`expected key "morning" to be present`)
	}
	if got.LoadCount != 2 {
		t.Errorf("LoadCount = %d, want 2", got.LoadCount)
	}
	if !got.Known {
		t.Error("Known = false, want true")
	}
}

func TestWordsInCollapsesWhitespaceAndSkipsEmpty(t *testing.T) {
	newEcpTestDB(t)

	out := wordsIn(t, "hello   world", "u1")
	if _, ok := out["hello"]; !ok {
		t.Error(`expected key "hello" to be present`)
	}
	if _, ok := out["world"]; !ok {
		t.Error(`expected key "world" to be present`)
	}
	if len(out) != 2 {
		t.Errorf("len(out) = %d, want 2 (no empty-string entries from collapsed whitespace)", len(out))
	}
}
