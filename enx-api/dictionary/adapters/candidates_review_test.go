package adapters

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"enx-api/dictionary"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

func strPtr(s string) *string { return &s }

func setupFileCandidatesDB(t *testing.T, connections int) {
	t.Helper()
	previous := sqlitex.DB
	t.Cleanup(func() { sqlitex.DB = previous })
	if err := sqlitex.InitWithLogLevel(filepath.Join(t.TempDir(), "enx.db"), "warn"); err != nil {
		t.Fatal(err)
	}
	pool, err := sqlitex.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(connections)
	t.Cleanup(func() {
		if err := pool.Close(); err != nil {
			t.Error(err)
		}
	})
}

func seedCandidate(t *testing.T, english string, status dictionary.CandidateStatus, hits int, lastHit int64) {
	t.Helper()
	row := sqlitex.AICandidate{
		English: english, Chinese: "n. 候选", Quality: 5, PromptVersion: "v1",
		Status: string(status), HitCount: hits, FirstHitAt: 1, LastHitAt: lastHit,
	}
	if err := sqlitex.DB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
}

func TestListCandidatesFiltersByStatusOrdersAndPages(t *testing.T) {
	setupCandidatesDB(t)
	seedCandidate(t, "alpha", dictionary.CandidatePending, 1, 10)
	seedCandidate(t, "beta", dictionary.CandidatePending, 5, 20)
	seedCandidate(t, "gamma", dictionary.CandidatePending, 5, 30)
	seedCandidate(t, "delta", dictionary.CandidateRejected, 9, 40)
	store := AICandidates{}
	ctx := context.Background()

	rows, total, err := store.ListCandidates(ctx, dictionary.CandidatePending, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 3 || len(rows) != 3 {
		t.Fatalf("pending total = %d, rows = %d, want 3 and 3", total, len(rows))
	}
	if rows[0].English != "gamma" || rows[1].English != "beta" || rows[2].English != "alpha" {
		t.Fatalf("order = %s, %s, %s; want hit count desc then last hit desc (gamma, beta, alpha)",
			rows[0].English, rows[1].English, rows[2].English)
	}

	rows, total, err = store.ListCandidates(ctx, dictionary.CandidatePending, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if total != 3 || len(rows) != 1 || rows[0].English != "beta" {
		t.Fatalf("page = %+v total %d, want [beta] of 3", rows, total)
	}

	rows, total, err = store.ListCandidates(ctx, dictionary.CandidatePending, 1, 10)
	if err != nil || total != 3 || len(rows) != 0 {
		t.Fatalf("page past the end = %+v total %d err %v, want an empty page of 3", rows, total, err)
	}

	rows, total, err = store.ListCandidates(ctx, dictionary.CandidateRejected, 10, 0)
	if err != nil || total != 1 || len(rows) != 1 || rows[0].English != "delta" {
		t.Fatalf("rejected = %+v total %d err %v, want [delta]", rows, total, err)
	}
}

func TestListCandidatesUsesOneSnapshotDuringAnInsert(t *testing.T) {
	setupFileCandidatesDB(t, 2)
	db := sqlitex.DB
	var insertOnce sync.Once
	var inserted bool
	// Commit a write on a separate connection after the first read, before
	// the list can run its next query.
	if err := db.Callback().Query().After("gorm:query").Register("insert_candidate", func(*gorm.DB) {
		insertOnce.Do(func() {
			seedCandidate(t, "alpha", dictionary.CandidatePending, 1, 10)
			inserted = true
		})
	}); err != nil {
		t.Fatal(err)
	}

	store := AICandidates{}
	ctx := context.Background()
	rows, total, err := store.ListCandidates(ctx, dictionary.CandidatePending, 1, 0)
	if err != nil || !inserted || total != 0 || len(rows) != 0 {
		t.Fatalf("list during insert = %+v total %d err %v, insert committed = %v; want an empty snapshot", rows, total, err, inserted)
	}
	rows, total, err = store.ListCandidates(ctx, dictionary.CandidatePending, 1, 0)
	if err != nil || total != 1 || len(rows) != 1 || rows[0].English != "alpha" {
		t.Fatalf("list after insert = %+v total %d err %v, want [alpha] of 1", rows, total, err)
	}
}

func TestRejectAndUnrejectCandidate(t *testing.T) {
	setupCandidatesDB(t)
	seedCandidate(t, "alpha", dictionary.CandidatePending, 1, 10)
	store := AICandidates{}
	ctx := context.Background()

	if err := store.RejectCandidate(ctx, "ALPHA"); err != nil {
		t.Fatal(err)
	}
	if got := candidateRow(t, "alpha").Status; got != "rejected" {
		t.Fatalf("status = %q, want rejected", got)
	}
	if err := store.UnrejectCandidate(ctx, "alpha"); err != nil {
		t.Fatal(err)
	}
	if got := candidateRow(t, "alpha").Status; got != "pending" {
		t.Fatalf("status = %q, want pending", got)
	}
	if err := store.RejectCandidate(ctx, "missing"); !errors.Is(err, dictionary.ErrCandidateNotFound) {
		t.Fatalf("reject missing err = %v, want ErrCandidateNotFound", err)
	}
	if err := store.UnrejectCandidate(ctx, "missing"); !errors.Is(err, dictionary.ErrCandidateNotFound) {
		t.Fatalf("unreject missing err = %v, want ErrCandidateNotFound", err)
	}
}

func TestApproveCandidateCreatesAnAdminReviewedAIRowAndDeletesTheCandidate(t *testing.T) {
	setupCandidatesDB(t)
	seedCandidate(t, "alpha", dictionary.CandidatePending, 3, 10)
	created, err := AICandidates{}.ApproveCandidate(context.Background(), "Alpha")
	if err != nil || !created {
		t.Fatalf("approve created = %v, err = %v, want true", created, err)
	}
	var w sqlitex.Word
	if err := sqlitex.DB.Where("english = ?", "alpha").First(&w).Error; err != nil {
		t.Fatal(err)
	}
	if w.English != "alpha" || w.Source != "ai" || w.Chinese == nil || *w.Chinese != "n. 候选" || w.AIQuality == nil || *w.AIQuality != 5 ||
		w.AIPromptVersion == nil || *w.AIPromptVersion != "v1" {
		t.Fatalf("word = %+v, want an AI row with the candidate's content", w)
	}
	if w.AdminEditedAt == nil || *w.AdminEditedAt == 0 {
		t.Fatalf("admin_edited_at = %v, want set", w.AdminEditedAt)
	}
	if candidateCount(t) != 0 {
		t.Fatal("candidate still there after approve")
	}
}

func TestApproveCandidateLeavesALiveWordUntouched(t *testing.T) {
	setupCandidatesDB(t)
	seedCandidate(t, "alpha", dictionary.CandidatePending, 1, 10)
	if err := sqlitex.DB.Create(&sqlitex.Word{Id: "w1", English: "alpha", Chinese: strPtr("existing"), Source: "ecdict"}).Error; err != nil {
		t.Fatal(err)
	}
	created, err := AICandidates{}.ApproveCandidate(context.Background(), "alpha")
	if err != nil || created {
		t.Fatalf("approve created = %v, err = %v, want false and no error", created, err)
	}
	var w sqlitex.Word
	if err := sqlitex.DB.Where("english = ?", "alpha").First(&w).Error; err != nil {
		t.Fatal(err)
	}
	if w.Id != "w1" || w.Chinese == nil || *w.Chinese != "existing" || w.Source != "ecdict" || w.AdminEditedAt != nil {
		t.Fatalf("word = %+v, want it unchanged", w)
	}
	if candidateCount(t) != 0 {
		t.Fatal("candidate still there")
	}
}

func TestApproveCandidateRevivesASoftDeletedWord(t *testing.T) {
	setupCandidatesDB(t)
	seedCandidate(t, "alpha", dictionary.CandidatePending, 1, 10)
	deleted := int64(5)
	if err := sqlitex.DB.Create(&sqlitex.Word{Id: "w1", English: "ALPHA", Chinese: strPtr("old"), Source: "ecdict", DeletedAt: &deleted}).Error; err != nil {
		t.Fatal(err)
	}
	created, err := AICandidates{}.ApproveCandidate(context.Background(), "Alpha")
	if err != nil || !created {
		t.Fatalf("approve created = %v, err = %v, want true", created, err)
	}
	var rows []sqlitex.Word
	if err := sqlitex.DB.Where("english = ?", "alpha").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("%d word rows, want 1", len(rows))
	}
	w := rows[0]
	if w.Id != "w1" || w.English != "alpha" || w.DeletedAt != nil || w.Chinese == nil || *w.Chinese != "n. 候选" || w.Source != "ai" || w.AdminEditedAt == nil {
		t.Fatalf("word = %+v, want the revived row overwritten with the candidate", w)
	}
}

func TestApproveCandidateMissingIsNotFound(t *testing.T) {
	setupCandidatesDB(t)
	_, err := AICandidates{}.ApproveCandidate(context.Background(), "nope")
	if !errors.Is(err, dictionary.ErrCandidateNotFound) {
		t.Fatalf("err = %v, want ErrCandidateNotFound", err)
	}
}

func TestApproveCandidateFailureRollsBack(t *testing.T) {
	setupCandidatesDB(t)
	seedCandidate(t, "alpha", dictionary.CandidatePending, 1, 10)
	// FAIL leaves the inserted row in the transaction for rollback to remove.
	if err := sqlitex.DB.Exec(`CREATE TRIGGER fail_word_insert AFTER INSERT ON words
		BEGIN SELECT RAISE(FAIL, 'approval write failed'); END`).Error; err != nil {
		t.Fatal(err)
	}
	_, err := AICandidates{}.ApproveCandidate(context.Background(), "alpha")
	if err == nil || !strings.Contains(err.Error(), "approval write failed") {
		t.Fatalf("err = %v, want the injected insert failure", err)
	}
	if got := candidateRow(t, "alpha").Status; got != "pending" {
		t.Fatalf("status = %q, want the candidate to stay pending", got)
	}
	var count int64
	if err := sqlitex.DB.Model(&sqlitex.Word{}).Where("english = ?", "alpha").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("word rows after failed approval = %d, want 0", count)
	}
}

func TestConcurrentApprovesOfOneCandidateSucceedOnce(t *testing.T) {
	const n = 5
	setupFileCandidatesDB(t, n)
	seedCandidate(t, "alpha", dictionary.CandidatePending, 1, 10)
	var ready, done sync.WaitGroup
	ready.Add(n)
	done.Add(n)
	start := make(chan struct{})
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer done.Done()
			ready.Done()
			<-start
			_, errs[i] = AICandidates{}.ApproveCandidate(context.Background(), "alpha")
		}(i)
	}
	ready.Wait()
	close(start)
	done.Wait()
	ok, notFound := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, dictionary.ErrCandidateNotFound):
			notFound++
		default:
			t.Fatalf("unexpected error %v", err)
		}
	}
	if ok != 1 || notFound != n-1 {
		t.Fatalf("ok = %d, notFound = %d, want 1 and %d", ok, notFound, n-1)
	}
	var count int64
	if err := sqlitex.DB.Model(&sqlitex.Word{}).Where("english = ?", "alpha").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("%d word rows, want 1", count)
	}
}
