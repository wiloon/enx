package adapters

import (
	"context"
	"errors"
	"sync"
	"testing"

	"enx-api/dictionary"
	"enx-api/utils/sqlitex"
)

func strPtr(s string) *string { return &s }

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

	rows, total, err = store.ListCandidates(ctx, dictionary.CandidateRejected, 10, 0)
	if err != nil || total != 1 || len(rows) != 1 || rows[0].English != "delta" {
		t.Fatalf("rejected = %+v total %d err %v, want [delta]", rows, total, err)
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
	if w.Source != "ai" || w.Chinese == nil || *w.Chinese != "n. 候选" || w.AIQuality == nil || *w.AIQuality != 5 ||
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
	if err := sqlitex.DB.Create(&sqlitex.Word{Id: "w1", English: "alpha", Chinese: strPtr("old"), Source: "ecdict", DeletedAt: &deleted}).Error; err != nil {
		t.Fatal(err)
	}
	created, err := AICandidates{}.ApproveCandidate(context.Background(), "alpha")
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
	if w.Id != "w1" || w.DeletedAt != nil || w.Chinese == nil || *w.Chinese != "n. 候选" || w.Source != "ai" || w.AdminEditedAt == nil {
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
	if err := sqlitex.DB.Exec("DROP TABLE words").Error; err != nil {
		t.Fatal(err)
	}
	_, err := AICandidates{}.ApproveCandidate(context.Background(), "alpha")
	if err == nil || errors.Is(err, dictionary.ErrCandidateNotFound) {
		t.Fatalf("err = %v, want a failure", err)
	}
	if got := candidateRow(t, "alpha").Status; got != "pending" {
		t.Fatalf("status = %q, want the candidate to stay pending", got)
	}
}

func TestConcurrentApprovesOfOneCandidateSucceedOnce(t *testing.T) {
	setupCandidatesDB(t)
	seedCandidate(t, "alpha", dictionary.CandidatePending, 1, 10)
	const n = 5
	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = AICandidates{}.ApproveCandidate(context.Background(), "alpha")
		}(i)
	}
	wg.Wait()
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
	sqlitex.DB.Model(&sqlitex.Word{}).Where("english = ?", "alpha").Count(&count)
	if count != 1 {
		t.Fatalf("%d word rows, want 1", count)
	}
}
