package repo

import "testing"

func TestRecordWordLookup(t *testing.T) {
	db := newTestDB(t)

	for i, want := range []int{1, 2} {
		qc, acq, err := RecordWordLookup("u1", "w1")
		if err != nil || qc != want || acq {
			t.Fatalf("lookup %d: got %d/%v/%v, want %d/false/nil", i+1, qc, acq, err, want)
		}
	}

	// A lookup of a word marked as known puts it back into review.
	db.Model(&UserDict{}).Where("user_id = ? AND word_id = ?", "u1", "w1").Update("known", true)
	if qc, acq, err := RecordWordLookup("u1", "w1"); err != nil || qc != 3 || acq {
		t.Fatalf("lookup after mark: got %d/%v/%v, want 3/false/nil", qc, acq, err)
	}
}

func TestSetKnown(t *testing.T) {
	newTestDB(t)

	// No row yet: known, with no lookups. Setting it again leaves it known,
	// so a retried request can't undo it.
	for i := 1; i <= 2; i++ {
		if qc, acq, err := SetKnown("u1", "w1", true); err != nil || qc != 0 || !acq {
			t.Fatalf("set known %d: got %d/%v/%v, want 0/true/nil", i, qc, acq, err)
		}
	}
	if _, _, err := RecordWordLookup("u1", "w1"); err != nil {
		t.Fatal(err)
	}
	// The lookup reset it to learning (count 1); setting it keeps the count.
	if qc, acq, err := SetKnown("u1", "w1", true); err != nil || qc != 1 || !acq {
		t.Fatalf("set known after lookup: got %d/%v/%v, want 1/true/nil", qc, acq, err)
	}
	for i := 1; i <= 2; i++ {
		if qc, acq, err := SetKnown("u1", "w1", false); err != nil || qc != 1 || acq {
			t.Fatalf("set not known %d: got %d/%v/%v, want 1/false/nil", i, qc, acq, err)
		}
	}
}

// Setting a word the user never touched to not known reports the learning
// state with no lookups and writes no row: a row would put a word the user
// never looked up into their Word List and vocabulary totals.
func TestSetKnownFalseWithoutRowWritesNothing(t *testing.T) {
	db := newTestDB(t)

	if qc, acq, err := SetKnown("u1", "w1", false); err != nil || qc != 0 || acq {
		t.Fatalf("got %d/%v/%v, want 0/false/nil", qc, acq, err)
	}
	var rows int64
	db.Model(&UserDict{}).Count(&rows)
	if rows != 0 {
		t.Fatalf("user_dicts rows = %d, want 0", rows)
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
