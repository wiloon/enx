package enx

import (
	"testing"
	"time"

	"enx-api/repo"
)

func TestQueryCountInTextDigitLeadingToken(t *testing.T) {
	newEcpTestDB(t)

	out := QueryCountInText("6-year-old", "u1")
	got, ok := out["6-year-old"]
	if !ok {
		t.Fatal(`expected key "6-year-old" to be present`)
	}
	if got.WordType != 1 {
		t.Errorf("WordType = %d, want 1 for a digit-leading token", got.WordType)
	}
}

func TestQueryCountInTextWordNotInDB(t *testing.T) {
	newEcpTestDB(t)

	out := QueryCountInText("morning", "u1")
	got, ok := out["morning"]
	if !ok {
		t.Fatal(`expected key "morning" to be present`)
	}
	if got.LoadCount != 0 || got.AlreadyAcquainted != 0 {
		t.Errorf("expected a fresh word to have LoadCount=0 AlreadyAcquainted=0, got %+v", got)
	}
}

func TestQueryCountInTextWordWithExistingUserDict(t *testing.T) {
	db := newEcpTestDB(t)
	now := time.Now().UnixMilli()
	if err := db.Create(&repo.Word{Id: "id-morning", English: "morning", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&repo.UserDict{UserId: "u1", WordId: "id-morning", QueryCount: 2, AlreadyAcquainted: 1, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	out := QueryCountInText("morning", "u1")
	got, ok := out["morning"]
	if !ok {
		t.Fatal(`expected key "morning" to be present`)
	}
	if got.LoadCount != 2 {
		t.Errorf("LoadCount = %d, want 2", got.LoadCount)
	}
	if got.AlreadyAcquainted != 1 {
		t.Errorf("AlreadyAcquainted = %d, want 1", got.AlreadyAcquainted)
	}
}

func TestQueryCountInTextCollapsesWhitespaceAndSkipsEmpty(t *testing.T) {
	newEcpTestDB(t)

	out := QueryCountInText("hello   world", "u1")
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
