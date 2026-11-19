package adapters

import (
	"context"
	"sync"
	"testing"

	"enx-api/dictionary"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func setupCandidatesDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1) // every connection to :memory: is its own database
	if err := db.AutoMigrate(&sqlitex.Word{}, &sqlitex.AICandidate{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
}

func newCandidate(english string) dictionary.Candidate {
	return dictionary.Candidate{
		English: english, Chinese: "n. 候选", Quality: 5, PromptVersion: "v1",
		Status: dictionary.CandidatePending, HitCount: 1,
	}
}

func candidateRow(t *testing.T, english string) sqlitex.AICandidate {
	t.Helper()
	var row sqlitex.AICandidate
	if err := sqlitex.DB.Where("english = ?", english).First(&row).Error; err != nil {
		t.Fatalf("candidate %q: %v", english, err)
	}
	return row
}

func candidateCount(t *testing.T) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Model(&sqlitex.AICandidate{}).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

func TestAICandidatesAreOneRowPerWordWhateverTheCaseOrApostrophe(t *testing.T) {
	setupCandidatesDB(t)
	ctx := context.Background()
	store := AICandidates{}
	if affected, err := store.AddCandidate(ctx, newCandidate("Don’t")); err != nil || !affected {
		t.Fatalf("AddCandidate affected = %v, err = %v, want true and no error", affected, err)
	}
	if affected, err := store.AddCandidate(ctx, newCandidate("DON'T")); err != nil || !affected {
		t.Fatalf("AddCandidate affected = %v, err = %v, want true and no error", affected, err)
	}
	if n := candidateCount(t); n != 1 {
		t.Fatalf("rows = %d, want 1", n)
	}
	c, ok, err := store.FindCandidate(ctx, "don’t")
	if err != nil || !ok {
		t.Fatalf("find = %v %v", ok, err)
	}
	if c.HitCount != 2 || c.Status != dictionary.CandidatePending || c.English != "Don't" {
		t.Fatalf("candidate = %+v", c)
	}
}

func TestAICandidateInsertConflictKeepsStatusAndDefinition(t *testing.T) {
	setupCandidatesDB(t)
	ctx := context.Background()
	store := AICandidates{}
	if affected, err := store.AddCandidate(ctx, newCandidate("rizzler")); err != nil || !affected {
		t.Fatalf("AddCandidate affected = %v, err = %v, want true and no error", affected, err)
	}
	update := sqlitex.DB.Model(&sqlitex.AICandidate{}).Where("english = ?", "rizzler").
		Update("status", string(dictionary.CandidateRejected))
	if update.Error != nil || update.RowsAffected != 1 {
		t.Fatalf("reject candidate: affected %d rows, err = %v", update.RowsAffected, update.Error)
	}

	second := newCandidate("rizzler")
	second.Chinese = "n. 另一个"
	if affected, err := store.AddCandidate(ctx, second); err != nil || !affected {
		t.Fatalf("AddCandidate affected = %v, err = %v, want true and no error", affected, err)
	}
	row := candidateRow(t, "rizzler")
	if row.Status != "rejected" || row.Chinese != "n. 候选" || row.HitCount != 2 {
		t.Fatalf("row = %+v, want rejected, first definition, 2 hits", row)
	}
}

func TestAICandidateInsertIsSkippedWhenWordsHasALiveRow(t *testing.T) {
	setupCandidatesDB(t)
	seedWord(t, "rizzler", "n. 已有")

	if affected, err := (AICandidates{}).AddCandidate(context.Background(), newCandidate("rizzler")); err != nil || affected {
		t.Fatalf("AddCandidate affected = %v, err = %v, want false and no error", affected, err)
	}
	if n := candidateCount(t); n != 0 {
		t.Fatalf("rows = %d, want none", n)
	}
}

func TestAICandidateHitCountIncrementsAtomically(t *testing.T) {
	setupCandidatesDB(t)
	ctx := context.Background()
	store := AICandidates{}
	if affected, err := store.AddCandidate(ctx, newCandidate("rizzler")); err != nil || !affected {
		t.Fatalf("AddCandidate affected = %v, err = %v, want true and no error", affected, err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := store.HitCandidate(ctx, "Rizzler"); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if got := candidateRow(t, "rizzler").HitCount; got != 21 {
		t.Fatalf("hit count = %d, want 21", got)
	}
}

func TestGuardedWordWriteSkipsARejectedCandidate(t *testing.T) {
	setupCandidatesDB(t)
	ctx := context.Background()
	c := newCandidate("rizzler")
	c.Status = dictionary.CandidateRejected
	if err := sqlitex.DB.Create(&sqlitex.AICandidate{
		English: c.English, Chinese: c.Chinese, Quality: 5, Status: "rejected", HitCount: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}

	id, stored, err := AICandidates{}.AddAIWord(ctx, dictionary.Entry{
		English: "rizzler", Chinese: "n. 高质量", Origin: dictionary.OriginAI, Quality: 9, PromptVersion: "v1",
	})
	if err != nil || stored || id != "" {
		t.Fatalf("got %q %v %v, want nothing stored", id, stored, err)
	}
	var n int64
	if err := sqlitex.DB.Model(&sqlitex.Word{}).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("words rows = %d, want 0", n)
	}
	if candidateRow(t, "rizzler").Status != "rejected" {
		t.Fatal("the candidate must stay rejected")
	}
}

func TestGuardedWordWriteWithAPendingCandidateInsertsAndDeletesIt(t *testing.T) {
	setupCandidatesDB(t)
	ctx := context.Background()
	if affected, err := (AICandidates{}).AddCandidate(ctx, newCandidate("rizzler")); err != nil || !affected {
		t.Fatalf("AddCandidate affected = %v, err = %v, want true and no error", affected, err)
	}

	id, stored, err := AICandidates{}.AddAIWord(ctx, dictionary.Entry{
		English: "rizzler", Chinese: "n. 高质量", Origin: dictionary.OriginAI, Quality: 9, PromptVersion: "v1",
	})
	if err != nil || !stored || id == "" {
		t.Fatalf("got %q %v %v", id, stored, err)
	}
	var w sqlitex.Word
	if err := sqlitex.DB.Where("id = ?", id).First(&w).Error; err != nil {
		t.Fatal(err)
	}
	if w.Source != "ai" || w.AIQuality == nil || *w.AIQuality != 9 || w.AdminEditedAt != nil {
		t.Fatalf("word = %+v", w)
	}
	if n := candidateCount(t); n != 0 {
		t.Fatalf("candidates = %d, want the pending one deleted", n)
	}
}

func TestGuardedWordWriteWithNoCandidateInsertsLikeToday(t *testing.T) {
	setupCandidatesDB(t)
	id, stored, err := AICandidates{}.AddAIWord(context.Background(), dictionary.Entry{
		English: "rizzler", Chinese: "n. 高质量", Origin: dictionary.OriginAI, Quality: 9, PromptVersion: "v1",
	})
	if err != nil || !stored || id == "" {
		t.Fatalf("got %q %v %v", id, stored, err)
	}
}

func TestGuardedWordWriteWithALiveRowReturnsItsIDAndLeavesItUnchanged(t *testing.T) {
	setupCandidatesDB(t)
	winner := seedWord(t, "rizzler", "n. 先到的")

	id, stored, err := AICandidates{}.AddAIWord(context.Background(), dictionary.Entry{
		English: "Rizzler", Chinese: "n. 后到的", Origin: dictionary.OriginAI, Quality: 9, PromptVersion: "v1",
	})
	if err != nil || !stored || id != winner {
		t.Fatalf("got %q %v %v, want the winner %q", id, stored, err, winner)
	}
	var w sqlitex.Word
	if err := sqlitex.DB.Where("id = ?", winner).First(&w).Error; err != nil {
		t.Fatal(err)
	}
	if w.Chinese == nil || *w.Chinese != "n. 先到的" {
		t.Fatalf("existing row changed: %+v", w)
	}
}
