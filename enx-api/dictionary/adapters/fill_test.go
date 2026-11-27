package adapters

import (
	"context"
	"testing"

	"enx-api/dictionary"
	"enx-api/repo"
	"enx-api/utils/sqlitex"
)

// seedEmptyWord seeds a live words row with no Chinese (ADR-098 Decision 5).
func seedEmptyWord(t *testing.T, english string) string {
	t.Helper()
	id := seedWord(t, english, "")
	if err := sqlitex.DB.Model(&repo.Word{}).Where("id = ?", id).Update("source", "wiktionary").Error; err != nil {
		t.Fatal(err)
	}
	return id
}

func wordRow(t *testing.T, id string) repo.Word {
	t.Helper()
	var row repo.Word
	if err := sqlitex.DB.Where("id = ?", id).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	return row
}

func TestWordsTableFindTreatsARowWithoutChineseAsAMiss(t *testing.T) {
	setupWordsDB(t)
	seedEmptyWord(t, "light")
	id := seedEmptyWord(t, "went")
	if err := sqlitex.DB.Exec("UPDATE words SET chinese = NULL WHERE id = ?", id).Error; err != nil {
		t.Fatal(err)
	}

	for _, english := range []string{"light", "went"} {
		for _, includeAI := range []bool{false, true} {
			if _, entry, ok, err := (WordsTable{}).Find(context.Background(), english, includeAI); ok || err != nil {
				t.Errorf("Find(%s, %v) = %+v, %v, %v; want a miss", english, includeAI, entry, ok, err)
			}
		}
	}
}

var aiEntry = dictionary.Entry{English: "light", Chinese: "n. 光", Origin: dictionary.OriginAI, Quality: 9, PromptVersion: "v1"}

// assertFilledByAI checks the row was filled in place and is hidden from a
// user who cannot use AI (ADR-045 Decision 6).
func assertFilledByAI(t *testing.T, id string) {
	t.Helper()
	row := wordRow(t, id)
	if row.Chinese != "n. 光" || row.Source != "ai" || row.AIQuality == nil || *row.AIQuality != 9 ||
		row.AIPromptVersion == nil || *row.AIPromptVersion != "v1" || row.AdminEditedAt != nil {
		t.Fatalf("row = %+v, want filled as an AI row", row)
	}
	if _, _, ok, err := (WordsTable{}).Find(context.Background(), "light", false); ok || err != nil {
		t.Fatalf("without AI: ok=%v err=%v, want the filled AI row hidden", ok, err)
	}
	if got, _, ok, err := (WordsTable{}).Find(context.Background(), "light", true); !ok || err != nil || got != id {
		t.Fatalf("with AI: %q %v %v, want row %s", got, ok, err, id)
	}
}

func TestWordsTableAddFillsARowWithoutChinese(t *testing.T) {
	setupWordsDB(t)
	id := seedEmptyWord(t, "light")

	got, err := WordsTable{}.Add(context.Background(), dictionary.Entry{English: "Light", Chinese: "n. 光", Pronunciation: "laɪt"})
	if err != nil || got != id {
		t.Fatalf("Add = %q, %v; want the row's id %s", got, err, id)
	}
	if row := wordRow(t, id); row.Chinese != "n. 光" || row.Pronunciation != "laɪt" || row.Source != "ecdict" || row.English != "light" {
		t.Fatalf("row = %+v, want filled from ECDICT", row)
	}

	// A row with Chinese is left unchanged.
	if _, err := (WordsTable{}).Add(context.Background(), aiEntry); err != nil {
		t.Fatal(err)
	}
	if row := wordRow(t, id); row.Source != "ecdict" || row.Pronunciation != "laɪt" || row.AIQuality != nil {
		t.Fatalf("row = %+v, want unchanged", row)
	}
}

func TestWordsTableAddFillsARowWithoutChineseFromAI(t *testing.T) {
	setupWordsDB(t)
	id := seedEmptyWord(t, "light")

	if got, err := (WordsTable{}).Add(context.Background(), aiEntry); err != nil || got != id {
		t.Fatalf("Add = %q, %v; want %s", got, err, id)
	}
	assertFilledByAI(t, id)
}

func TestAddAIWordFillsARowWithoutChinese(t *testing.T) {
	setupCandidatesDB(t)
	id := seedEmptyWord(t, "light")

	got, stored, err := AICandidates{}.AddAIWord(context.Background(), aiEntry)
	if err != nil || !stored || got != id {
		t.Fatalf("AddAIWord = %q, %v, %v; want the row's id %s", got, stored, err, id)
	}
	assertFilledByAI(t, id)
}

func TestAddAIWordWithARejectedCandidateLeavesARowWithoutChinese(t *testing.T) {
	setupCandidatesDB(t)
	id := seedEmptyWord(t, "light")
	if err := sqlitex.DB.Create(&sqlitex.AICandidate{English: "light", Chinese: "n. 光", Status: "rejected"}).Error; err != nil {
		t.Fatal(err)
	}

	if _, stored, err := (AICandidates{}).AddAIWord(context.Background(), aiEntry); stored || err != nil {
		t.Fatalf("stored=%v err=%v, want nothing written", stored, err)
	}
	if row := wordRow(t, id); row.Chinese != "" || row.Source != "wiktionary" {
		t.Fatalf("row = %+v, want unchanged", row)
	}
}

func TestACandidateIsRecordedForARowWithoutChineseAndApprovalFillsIt(t *testing.T) {
	setupCandidatesDB(t)
	ctx := context.Background()
	id := seedEmptyWord(t, "light")

	affected, err := AICandidates{}.AddCandidate(ctx, newCandidate("light"))
	if err != nil || !affected {
		t.Fatalf("AddCandidate = %v, %v; want the candidate recorded", affected, err)
	}
	created, err := AICandidates{}.ApproveCandidate(ctx, "light")
	if err != nil || !created {
		t.Fatalf("ApproveCandidate = %v, %v; want the definition written", created, err)
	}
	row := wordRow(t, id)
	if row.Chinese != "n. 候选" || row.Source != "ai" || row.AdminEditedAt == nil || row.AIQuality == nil || *row.AIQuality != 5 {
		t.Fatalf("row = %+v, want filled and admin-reviewed", row)
	}
	if n := candidateCount(t); n != 0 {
		t.Fatalf("%d candidates left, want none", n)
	}
}

func TestAnAdminEditGivingChineseMakesTheRowAnECDICTRow(t *testing.T) {
	setupWordsDB(t)
	id := seedEmptyWord(t, "light")

	if _, err := repo.AdminEditWord("light", "n. 光", ""); err != nil {
		t.Fatal(err)
	}
	if row := wordRow(t, id); row.Source != "ecdict" {
		t.Fatalf("source = %q, want ecdict", row.Source)
	}
}
