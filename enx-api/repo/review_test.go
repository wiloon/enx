package repo

import (
	"testing"

	"enx-api/utils/sqlitex"
)

func TestAdminDeleteWordRemovesItsReviews(t *testing.T) {
	db := newTestDB(t)
	db.Create(&Word{Id: "w1", English: "hello", CreatedAt: 1, UpdatedAt: 1})
	db.Create(&Word{Id: "w2", English: "world", CreatedAt: 1, UpdatedAt: 1})
	for _, ud := range []UserDict{{UserId: "u1", WordId: "w1"}, {UserId: "u2", WordId: "w1"}, {UserId: "u1", WordId: "w2"}} {
		ud.CreatedAt, ud.UpdatedAt = 1, 1
		db.Create(&ud)
		db.Create(&sqlitex.ReviewState{UserID: ud.UserId, WordID: ud.WordId})
		db.Create(&sqlitex.ReviewLog{UserID: ud.UserId, WordID: ud.WordId, Type: "lookup", Source: "unknown"})
	}

	deleted, err := AdminDeleteWord("hello")
	if err != nil || !deleted {
		t.Fatalf("got %v, %v; want deleted", deleted, err)
	}
	var words, reviews int64
	db.Model(&Word{}).Count(&words)
	db.Model(&UserDict{}).Count(&reviews)
	if words != 1 || reviews != 1 {
		t.Fatalf("left %d words, %d user_dicts; want only world's 1 and 1", words, reviews)
	}
	var states, logs int64
	db.Model(&sqlitex.ReviewState{}).Count(&states)
	db.Model(&sqlitex.ReviewLog{}).Count(&logs)
	if states != 1 || logs != 1 {
		t.Fatalf("left %d review states, %d review logs; want only world's 1 and 1", states, logs)
	}

	if deleted, err := AdminDeleteWord("absent"); err != nil || deleted {
		t.Fatalf("absent word: got %v, %v; want not deleted, no error", deleted, err)
	}
}
