package repo

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"enx-api/utils/sqlitex"
)

func TestWordStatesByEnglish(t *testing.T) {
	db := newTestDB(t)
	deleted := int64(5)
	for _, w := range []Word{
		{Id: "w1", English: "Run"},
		{Id: "w2", English: "walk"},
		{Id: "w3", English: "gone", DeletedAt: &deleted},
	} {
		w.CreatedAt, w.UpdatedAt = 1, 1
		db.Create(&w)
	}
	for _, ud := range []UserDict{
		{UserId: "u1", WordId: "w1", QueryCount: 3, AlreadyAcquainted: 1},
		{UserId: "u2", WordId: "w2", QueryCount: 7},
	} {
		ud.CreatedAt, ud.UpdatedAt = 1, 1
		db.Create(&ud)
	}

	states, err := WordStatesByEnglish("u1", []string{"run", "WALK", "gone", "absent"})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]WordState{}
	for _, s := range states {
		got[s.Id] = s
	}
	want := map[string]WordState{
		"w1": {Id: "w1", English: "Run", QueryCount: 3, AlreadyAcquainted: 1},
		"w2": {Id: "w2", English: "walk"}, // u2's row is not u1's
	}
	if len(got) != len(want) || got["w1"] != want["w1"] || got["w2"] != want["w2"] {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

// More words than one IN list holds are split across queries, none lost.
func TestWordStatesByEnglishChunks(t *testing.T) {
	db := newTestDB(t)
	var englishes []string
	for i := 0; i < wordStatesChunk*2+7; i++ {
		e := fmt.Sprintf("word%04d", i)
		englishes = append(englishes, e)
		db.Create(&Word{Id: "id-" + e, English: e, CreatedAt: 1, UpdatedAt: 1})
	}

	states, err := WordStatesByEnglish("u1", englishes)
	if err != nil || len(states) != len(englishes) {
		t.Fatalf("got %d states, %v; want %d", len(states), err, len(englishes))
	}
}

// The lookup must stay an index search: a table scan per paragraph is the
// cost this query exists to avoid.
func TestWordStatesByEnglishUsesTheLowerEnglishIndex(t *testing.T) {
	if err := os.Setenv("DB_PATH", filepath.Join(t.TempDir(), "plan.db")); err != nil {
		t.Fatal(err)
	}
	sqlitex.Init() // the real schema, including idx_words_english_lower

	var plan []struct{ Detail string }
	if err := sqlitex.DB.Raw("EXPLAIN QUERY PLAN "+wordStatesSQL, "u1", []string{"a", "b"}).Scan(&plan).Error; err != nil {
		t.Fatal(err)
	}
	var details []string
	for _, p := range plan {
		details = append(details, p.Detail)
	}
	joined := strings.Join(details, " | ")
	if !strings.Contains(joined, "idx_words_english_lower") {
		t.Fatalf("plan does not use idx_words_english_lower: %s", joined)
	}
}
