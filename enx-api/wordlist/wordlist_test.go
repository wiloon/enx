package wordlist

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"enx-api/utils"
	"enx-api/utils/sqlitex"
)

func TestMain(m *testing.M) {
	dbPath := filepath.Join(os.TempDir(), "enx-wordlist-test.db")
	os.Remove(dbPath)
	utils.ViperInit()
	sqlitex.Init(dbPath)
	os.Exit(m.Run())
}

// seed is one user_dicts row plus the words row it points at.
type seed struct {
	english   string
	chinese   string
	count     int
	known     bool
	createdAt time.Time
	updatedAt time.Time
	deleted   bool
}

func insert(t *testing.T, userID string, s seed) {
	t.Helper()
	// words.english is unique across the table, so tests that reuse a word
	// get a per-test spelling.
	chinese := s.chinese
	word := sqlitex.Word{
		Id:        uuid.NewString(),
		English:   s.english,
		Chinese:   &chinese,
		CreatedAt: s.createdAt.UnixMilli(),
		UpdatedAt: s.createdAt.UnixMilli(),
	}
	if s.deleted {
		at := s.updatedAt.UnixMilli()
		word.DeletedAt = &at
	}
	if err := sqlitex.DB.Create(&word).Error; err != nil {
		t.Fatalf("insert word %q: %v", s.english, err)
	}
	known := 0
	if s.known {
		known = 1
	}
	dict := sqlitex.UserDict{
		UserId:            userID,
		WordId:            word.Id,
		QueryCount:        s.count,
		AlreadyAcquainted: known,
		CreatedAt:         s.createdAt.UnixMilli(),
		UpdatedAt:         s.updatedAt.UnixMilli(),
	}
	if err := sqlitex.DB.Create(&dict).Error; err != nil {
		t.Fatalf("insert user_dict %q: %v", s.english, err)
	}
}

func englishOf(entries []Entry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.English
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

var day = time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)

func TestListReturnsTheUsersWordsMostRecentlyTouchedFirst(t *testing.T) {
	user := "u-" + t.Name()
	insert(t, user, seed{english: "wl-old", chinese: "旧", count: 3, createdAt: day, updatedAt: day})
	insert(t, user, seed{english: "wl-new", chinese: "新", count: 1, createdAt: day, updatedAt: day.Add(2 * time.Hour)})
	insert(t, user, seed{english: "wl-mid", chinese: "中", count: 7, known: true, createdAt: day, updatedAt: day.Add(time.Hour)})

	got, err := List(context.Background(), user, Query{Status: StatusAll})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if want := []string{"wl-new", "wl-mid", "wl-old"}; !equal(englishOf(got.Entries), want) {
		t.Fatalf("order = %v, want %v", englishOf(got.Entries), want)
	}
	if got.Total != 3 {
		t.Fatalf("Total = %d, want 3", got.Total)
	}

	mid := got.Entries[1]
	if mid.Chinese != "中" || mid.QueryCount != 7 || !mid.Known {
		t.Fatalf("entry = %+v, want chinese 中, count 7, known", mid)
	}
	if !mid.FirstLookedUpAt.Equal(day) || !mid.UpdatedAt.Equal(day.Add(time.Hour)) {
		t.Fatalf("times = %v / %v, want %v / %v", mid.FirstLookedUpAt, mid.UpdatedAt, day, day.Add(time.Hour))
	}
}

func TestListFiltersByLearningOrKnown(t *testing.T) {
	user := "u-" + t.Name()
	insert(t, user, seed{english: "wl-learning", count: 1, createdAt: day, updatedAt: day})
	insert(t, user, seed{english: "wl-known", count: 5, known: true, createdAt: day, updatedAt: day})

	learning, err := List(context.Background(), user, Query{Status: StatusLearning})
	if err != nil {
		t.Fatalf("List learning: %v", err)
	}
	if !equal(englishOf(learning.Entries), []string{"wl-learning"}) || learning.Total != 1 {
		t.Fatalf("learning = %v (total %d)", englishOf(learning.Entries), learning.Total)
	}

	known, err := List(context.Background(), user, Query{Status: StatusKnown})
	if err != nil {
		t.Fatalf("List known: %v", err)
	}
	if !equal(englishOf(known.Entries), []string{"wl-known"}) || known.Total != 1 {
		t.Fatalf("known = %v (total %d)", englishOf(known.Entries), known.Total)
	}
}

func TestListNeverShowsAnotherUsersWords(t *testing.T) {
	me, other := "u-"+t.Name(), "u-other-"+t.Name()
	insert(t, me, seed{english: "wl-mine", count: 1, createdAt: day, updatedAt: day})
	insert(t, other, seed{english: "wl-theirs", count: 1, createdAt: day, updatedAt: day})

	got, err := List(context.Background(), me, Query{Status: StatusAll})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if !equal(englishOf(got.Entries), []string{"wl-mine"}) {
		t.Fatalf("entries = %v, want only wl-mine", englishOf(got.Entries))
	}
}

func TestListSkipsDeletedWords(t *testing.T) {
	user := "u-" + t.Name()
	insert(t, user, seed{english: "wl-live", count: 1, createdAt: day, updatedAt: day})
	insert(t, user, seed{english: "wl-gone", count: 1, createdAt: day, updatedAt: day, deleted: true})

	got, err := List(context.Background(), user, Query{Status: StatusAll})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if !equal(englishOf(got.Entries), []string{"wl-live"}) || got.Total != 1 {
		t.Fatalf("entries = %v (total %d), want only wl-live", englishOf(got.Entries), got.Total)
	}
}

func TestListSearchMatchesTheStartOfTheWordIgnoringCase(t *testing.T) {
	user := "u-" + t.Name()
	insert(t, user, seed{english: "wlsearch-Ephemeral", count: 1, createdAt: day, updatedAt: day})
	insert(t, user, seed{english: "wlsearch-meticulous", count: 1, createdAt: day, updatedAt: day})
	insert(t, user, seed{english: "x-wlsearch-eph", count: 1, createdAt: day, updatedAt: day})

	got, err := List(context.Background(), user, Query{Status: StatusAll, Search: "WLSEARCH-eph"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if !equal(englishOf(got.Entries), []string{"wlsearch-Ephemeral"}) || got.Total != 1 {
		t.Fatalf("entries = %v (total %d), want only wlsearch-Ephemeral", englishOf(got.Entries), got.Total)
	}
}

func TestListSearchTreatsLikeWildcardsAsLiteralText(t *testing.T) {
	user := "u-" + t.Name()
	insert(t, user, seed{english: "wlwild-abc", count: 1, createdAt: day, updatedAt: day})

	got, err := List(context.Background(), user, Query{Status: StatusAll, Search: "wlwild%"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got.Entries) != 0 {
		t.Fatalf("entries = %v, want none: %% must not act as a wildcard", englishOf(got.Entries))
	}
}

func TestListPagesWithLimitAndOffsetWhileTotalCountsEverything(t *testing.T) {
	user := "u-" + t.Name()
	for i, w := range []string{"wlpage-a", "wlpage-b", "wlpage-c"} {
		insert(t, user, seed{english: w, count: 1, createdAt: day, updatedAt: day.Add(time.Duration(i) * time.Minute)})
	}

	got, err := List(context.Background(), user, Query{Status: StatusAll, Limit: 2, Offset: 1})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if !equal(englishOf(got.Entries), []string{"wlpage-b", "wlpage-a"}) {
		t.Fatalf("page = %v, want [wlpage-b wlpage-a]", englishOf(got.Entries))
	}
	if got.Total != 3 {
		t.Fatalf("Total = %d, want 3", got.Total)
	}
}

func TestListGivesANewUserAnEmptyNonNilPage(t *testing.T) {
	got, err := List(context.Background(), "u-"+t.Name(), Query{Status: StatusAll})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if got.Entries == nil || len(got.Entries) != 0 || got.Total != 0 {
		t.Fatalf("got %+v, want an empty non-nil page", got)
	}
}

func TestNormalizeClampsLimitAndOffset(t *testing.T) {
	cases := []struct {
		in         Query
		wantLimit  int
		wantOffset int
	}{
		{Query{}, DefaultLimit, 0},
		{Query{Limit: -5, Offset: -1}, DefaultLimit, 0},
		{Query{Limit: MaxLimit + 1}, MaxLimit, 0},
		{Query{Limit: 10, Offset: 20}, 10, 20},
	}
	for _, c := range cases {
		got := c.in.normalize()
		if got.Limit != c.wantLimit || got.Offset != c.wantOffset {
			t.Errorf("normalize(%+v) = limit %d offset %d, want %d %d", c.in, got.Limit, got.Offset, c.wantLimit, c.wantOffset)
		}
	}
}

func TestParseStatus(t *testing.T) {
	cases := map[string]Status{"": StatusAll, "all": StatusAll, "learning": StatusLearning, "known": StatusKnown}
	for in, want := range cases {
		got, err := ParseStatus(in)
		if err != nil || got != want {
			t.Errorf("ParseStatus(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	if _, err := ParseStatus("mastered"); !errors.Is(err, ErrInvalidStatus) {
		t.Errorf("ParseStatus(\"mastered\") err = %v, want ErrInvalidStatus", err)
	}
}
