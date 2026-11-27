package wordlist

import (
	"net/http"
	"testing"

	"enx-api/utils/sqlitex"
)

// GLOSSARY 移出生词本: the word is back to never looked up, review rows
// included, for this user only.
func TestRemoveHandlerDeletesTheUsersReviewRowsForTheWord(t *testing.T) {
	me, other := "u-"+t.Name(), "u-other-"+t.Name()
	insert(t, me, seed{english: "wlr-reviewed", count: 1, createdAt: day, updatedAt: day})
	insert(t, me, seed{english: "wlr-reviewed-kept", count: 1, createdAt: day, updatedAt: day})
	var gone, kept sqlitex.Word
	sqlitex.DB.Where("english = ?", "wlr-reviewed").First(&gone)
	sqlitex.DB.Where("english = ?", "wlr-reviewed-kept").First(&kept)
	for _, row := range []struct{ user, word string }{{me, gone.Id}, {me, kept.Id}, {other, gone.Id}} {
		if err := sqlitex.DB.Create(&sqlitex.ReviewState{UserID: row.user, WordID: row.word}).Error; err != nil {
			t.Fatal(err)
		}
		if err := sqlitex.DB.Create(&sqlitex.ReviewLog{UserID: row.user, WordID: row.word, Type: "lookup", Source: "unknown"}).Error; err != nil {
			t.Fatal(err)
		}
	}

	if w := remove(t, me, "wlr-reviewed"); w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", w.Code)
	}

	for _, table := range []string{"review_states", "review_logs"} {
		count := func(user, word string) (n int64) {
			sqlitex.DB.Table(table).Where("user_id = ? AND word_id = ?", user, word).Count(&n)
			return n
		}
		if count(me, gone.Id) != 0 || count(me, kept.Id) != 1 || count(other, gone.Id) != 1 {
			t.Errorf("%s: left %d of the removed word, %d of the kept one, %d of the other user's; want 0, 1, 1",
				table, count(me, gone.Id), count(me, kept.Id), count(other, gone.Id))
		}
	}
}
