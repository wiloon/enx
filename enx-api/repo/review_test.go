package repo

import "testing"

func TestRecordWordLookup(t *testing.T) {
	db := newTestDB(t)

	for i, want := range []int{1, 2} {
		qc, acq, err := RecordWordLookup("u1", "w1")
		if err != nil || qc != want || acq != 0 {
			t.Fatalf("lookup %d: got %d/%d/%v, want %d/0/nil", i+1, qc, acq, err, want)
		}
	}

	// A lookup of a word marked as known puts it back into review.
	db.Model(&UserDict{}).Where("user_id = ? AND word_id = ?", "u1", "w1").Update("already_acquainted", 1)
	if qc, acq, err := RecordWordLookup("u1", "w1"); err != nil || qc != 3 || acq != 0 {
		t.Fatalf("lookup after mark: got %d/%d/%v, want 3/0/nil", qc, acq, err)
	}
}

func TestToggleAcquainted(t *testing.T) {
	newTestDB(t)

	// No row yet: known, with no lookups.
	if qc, acq, err := ToggleAcquainted("u1", "w1"); err != nil || qc != 0 || acq != 1 {
		t.Fatalf("first toggle: got %d/%d/%v, want 0/1/nil", qc, acq, err)
	}
	if _, _, err := RecordWordLookup("u1", "w1"); err != nil {
		t.Fatal(err)
	}
	// The lookup reset it to learning (count 1); toggling keeps the count.
	if qc, acq, err := ToggleAcquainted("u1", "w1"); err != nil || qc != 1 || acq != 1 {
		t.Fatalf("second toggle: got %d/%d/%v, want 1/1/nil", qc, acq, err)
	}
	if qc, acq, err := ToggleAcquainted("u1", "w1"); err != nil || qc != 1 || acq != 0 {
		t.Fatalf("third toggle: got %d/%d/%v, want 1/0/nil", qc, acq, err)
	}
}

func TestAdminDeleteWordRemovesItsReviews(t *testing.T) {
	db := newTestDB(t)
	db.Create(&Word{Id: "w1", English: "hello", CreatedAt: 1, UpdatedAt: 1})
	db.Create(&Word{Id: "w2", English: "world", CreatedAt: 1, UpdatedAt: 1})
	for _, ud := range []UserDict{{UserId: "u1", WordId: "w1"}, {UserId: "u2", WordId: "w1"}, {UserId: "u1", WordId: "w2"}} {
		ud.CreatedAt, ud.UpdatedAt = 1, 1
		db.Create(&ud)
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

	if deleted, err := AdminDeleteWord("absent"); err != nil || deleted {
		t.Fatalf("absent word: got %v, %v; want not deleted, no error", deleted, err)
	}
}
