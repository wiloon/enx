package repo

import (
	"context"
	"testing"
)

// The review list is the user's looked-up, not-known rows on live words:
// known, zero-count, deleted and other users' rows stay out.
func TestReviewWordsListsOnlyTheUsersLookedUpUnknownLiveWords(t *testing.T) {
	db := newTestDB(t)
	deleted := int64(5)
	for _, w := range []Word{
		{Id: "w1", English: "Cat"},
		{Id: "w2", English: "dog"},
		{Id: "w3", English: "gone", DeletedAt: &deleted},
		{Id: "w4", English: "known"},
		{Id: "w5", English: "zero"},
		{Id: "w6", English: "theirs"},
	} {
		w.CreatedAt, w.UpdatedAt = 1, 1
		db.Create(&w)
	}
	for _, ud := range []UserDict{
		{UserId: "u1", WordId: "w1", QueryCount: 3},
		{UserId: "u1", WordId: "w2", QueryCount: 1},
		{UserId: "u1", WordId: "w3", QueryCount: 4},
		{UserId: "u1", WordId: "w4", QueryCount: 2, Known: true},
		{UserId: "u1", WordId: "w5", QueryCount: 0},
		{UserId: "u2", WordId: "w6", QueryCount: 9},
	} {
		ud.CreatedAt, ud.UpdatedAt = 1, 1
		db.Create(&ud)
	}

	got, err := ReviewWords{}.List(context.Background(), "u1")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"Cat": 3, "dog": 1}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %v", got, want)
	}
	for _, w := range got {
		if want[w.English] != w.QueryCount {
			t.Fatalf("got %+v, want %v", got, want)
		}
	}
}

func TestReviewWordsIsEmptyForAUserWithNoLookups(t *testing.T) {
	newTestDB(t)

	got, err := ReviewWords{}.List(context.Background(), "u1")
	if err != nil || len(got) != 0 {
		t.Fatalf("got %+v, %v; want no words", got, err)
	}
}
