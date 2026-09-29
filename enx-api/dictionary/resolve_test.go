package dictionary

import (
	"context"
	"errors"
	"testing"

	"enx-api/ecdict"
	"enx-api/utils/sqlitex"

	"github.com/google/uuid"
)

func seedLocalWord(t *testing.T, english, chinese string) string {
	t.Helper()
	id := uuid.NewString()
	if err := sqlitex.DB.Create(&sqlitex.Word{
		Id: id, English: english, Chinese: &chinese, CreatedAt: 1, UpdatedAt: 1,
	}).Error; err != nil {
		t.Fatalf("seed word %q: %v", english, err)
	}
	return id
}

func wordRowCount(t *testing.T) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Model(&sqlitex.Word{}).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

var runEntry = stardictRow{Word: "run", Sw: "run", Phonetic: "rʌn", Translation: "v. 跑", Exchange: "p:ran/d:run/i:running/3:runs"}

func TestResolveLocalHit(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t)
	id := seedLocalWord(t, "serendipity", "机缘巧合")

	res, err := Resolve(context.Background(), "serendipity", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceLocal || res.ID != id || res.Chinese != "机缘巧合" {
		t.Fatalf("got %+v, want local hit on %s", res, id)
	}
}

// A cached word needs no ECDICT, so it resolves even when ECDICT is down.
func TestResolveLocalHitWithoutEcdict(t *testing.T) {
	setupTestDB(t)
	ecdict.Init("")
	id := seedLocalWord(t, "serendipity", "机缘巧合")

	res, err := Resolve(context.Background(), "serendipity", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceLocal || res.ID != id {
		t.Fatalf("got %+v, want local hit on %s", res, id)
	}
}

// ADR-018 B2: a local hit counts against the daily quota like any lookup.
func TestResolveMetersLocalHit(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t)
	setQuotaLimits(t, 1, 0)
	seedLocalWord(t, "serendipity", "机缘巧合")
	ctx := context.Background()

	if _, err := Resolve(ctx, "serendipity", "u1"); err != nil {
		t.Fatalf("lookup 1: %v", err)
	}
	if _, err := Resolve(ctx, "serendipity", "u1"); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("lookup 2: got %v, want ErrQuotaExceeded", err)
	}
}

func TestResolveEcdictFillsTheWordsCache(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t, runEntry)

	res, err := Resolve(context.Background(), "run", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceEcdict || res.ID == "" || res.English != "run" ||
		res.Chinese != "v. 跑" || res.Pronunciation != "rʌn" {
		t.Fatalf("got %+v, want ECDICT entry for run", res)
	}

	again, err := Resolve(context.Background(), "run", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if again.Source != SourceLocal || again.ID != res.ID {
		t.Fatalf("second lookup: got %+v, want local hit on %s", again, res.ID)
	}
}

// An inflection resolves to its headword; when the headword is already
// cached, its row is reused rather than duplicated.
func TestResolveInflectionReusesCachedHeadword(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t, runEntry)
	id := seedLocalWord(t, "run", "v. 跑")

	res, err := Resolve(context.Background(), "ran", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceEcdict || res.ID != id || res.English != "run" {
		t.Fatalf("got %+v, want headword run on cached row %s", res, id)
	}
	if n := wordRowCount(t); n != 1 {
		t.Fatalf("words rows: got %d, want 1", n)
	}
}

func TestResolveMiss(t *testing.T) {
	setupTestDB(t)
	setupFakeEcdict(t, runEntry)

	res, err := Resolve(context.Background(), "zzxqv", "u1")
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != SourceMiss || res.ID != "" || res.English != "zzxqv" {
		t.Fatalf("got %+v, want miss", res)
	}
	if n := wordRowCount(t); n != 0 {
		t.Fatalf("words rows: got %d, want 0", n)
	}
}

func TestResolveUncachedWordWithoutEcdict(t *testing.T) {
	setupTestDB(t)
	ecdict.Init("")

	if _, err := Resolve(context.Background(), "serendipity", "u1"); !errors.Is(err, ErrEcdictUnavailable) {
		t.Fatalf("got %v, want ErrEcdictUnavailable", err)
	}
}
