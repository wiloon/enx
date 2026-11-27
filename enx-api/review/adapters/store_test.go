package adapters

import (
	"context"
	"errors"
	"testing"
	"time"

	"enx-api/repo"
	"enx-api/review"
	"enx-api/utils/sqlitex"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&sqlitex.Word{}, &repo.UserDict{}, &sqlitex.ReviewState{}, &sqlitex.ReviewLog{}); err != nil {
		t.Fatal(err)
	}
	sqlitex.DB = db
	return db
}

func inTx(t *testing.T, fn func(review.Tx) error) {
	t.Helper()
	if err := (Store{}).Transact(context.Background(), fn); err != nil {
		t.Fatal(err)
	}
}

type wordRow struct {
	count int
	known bool
}

func countLookup(t *testing.T) (got wordRow) {
	t.Helper()
	inTx(t, func(tx review.Tx) (err error) {
		got.count, got.known, err = tx.CountLookup("u1", "w1", time.Now())
		return err
	})
	return got
}

func setKnown(t *testing.T, known bool) (got wordRow) {
	t.Helper()
	inTx(t, func(tx review.Tx) (err error) {
		got.count, got.known, err = tx.SetKnown("u1", "w1", known, time.Now())
		return err
	})
	return got
}

func TestCountLookup(t *testing.T) {
	db := newTestDB(t)

	for _, want := range []int{1, 2} {
		if got := countLookup(t); got != (wordRow{want, false}) {
			t.Fatalf("lookup: got %+v, want %d/false", got, want)
		}
	}

	// A lookup of a word marked as known puts it back into review.
	db.Model(&repo.UserDict{}).Where("user_id = ? AND word_id = ?", "u1", "w1").Update("known", true)
	if got := countLookup(t); got != (wordRow{3, false}) {
		t.Fatalf("lookup after mark: got %+v, want 3/false", got)
	}
}

func TestSetKnown(t *testing.T) {
	newTestDB(t)

	// No row yet: known, with no lookups. Setting it again leaves it known,
	// so a retried request can't undo it.
	for range 2 {
		if got := setKnown(t, true); got != (wordRow{0, true}) {
			t.Fatalf("set known: got %+v, want 0/true", got)
		}
	}
	countLookup(t)
	// The lookup reset it to learning (count 1); setting it keeps the count.
	if got := setKnown(t, true); got != (wordRow{1, true}) {
		t.Fatalf("set known after lookup: got %+v, want 1/true", got)
	}
	for range 2 {
		if got := setKnown(t, false); got != (wordRow{1, false}) {
			t.Fatalf("set not known: got %+v, want 1/false", got)
		}
	}
}

// Setting a word the user never touched to not known reports the learning
// state with no lookups and writes no row: a row would put a word the user
// never looked up into their Word List and vocabulary totals.
func TestSetKnownFalseWithoutRowWritesNothing(t *testing.T) {
	db := newTestDB(t)

	if got := setKnown(t, false); got != (wordRow{}) {
		t.Fatalf("got %+v, want 0/false", got)
	}
	var rows int64
	db.Model(&repo.UserDict{}).Count(&rows)
	if rows != 0 {
		t.Fatalf("user_dicts rows = %d, want 0", rows)
	}
}

func TestStateRoundTrips(t *testing.T) {
	newTestDB(t)
	at := time.UnixMilli(1_800_000_000_000)
	want := review.State{UserID: "u1", WordID: "w1", Stability: 1.5, Difficulty: 6, Phase: 2,
		Due: at.Add(24 * time.Hour), LastReview: at, Reps: 1}

	inTx(t, func(tx review.Tx) error { return tx.SaveState(want) })
	want.Reps, want.Lapses, want.LastLapseAt, want.LookupRescheduledAt = 2, 1, at, at
	inTx(t, func(tx review.Tx) error { return tx.SaveState(want) })

	inTx(t, func(tx review.Tx) error {
		got, found, err := tx.State("u1", "w1")
		if !found || got != want {
			t.Errorf("state %+v (found %v), want %+v", got, found, want)
		}
		return err
	})
}

func TestAFailedTransactionKeepsNothing(t *testing.T) {
	db := newTestDB(t)
	failed := errors.New("failed")

	err := (Store{}).Transact(context.Background(), func(tx review.Tx) error {
		if _, _, err := tx.CountLookup("u1", "w1", time.Now()); err != nil {
			return err
		}
		return failed
	})

	var rows int64
	db.Model(&repo.UserDict{}).Count(&rows)
	if !errors.Is(err, failed) || rows != 0 {
		t.Fatalf("err %v, %d user_dicts rows; want the error and no row", err, rows)
	}
}

func seedWord(t *testing.T, id, english string, deleted bool) {
	t.Helper()
	row := sqlitex.Word{Id: id, English: english, CreatedAt: 1, UpdatedAt: 1}
	if deleted {
		ms := int64(2)
		row.DeletedAt = &ms
	}
	if err := sqlitex.DB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
}

func TestLiveWordIgnoresDeletedRows(t *testing.T) {
	newTestDB(t)
	seedWord(t, "live", "cat", false)
	seedWord(t, "gone", "dog", true)

	inTx(t, func(tx review.Tx) error {
		ok, err := tx.LiveWord("live")
		if err != nil || !ok {
			t.Fatalf("live: %v, %v", ok, err)
		}
		ok, err = tx.LiveWord("gone")
		if err != nil || ok {
			t.Fatalf("gone: %v, %v", ok, err)
		}
		ok, err = tx.LiveWord("missing")
		if err != nil || ok {
			t.Fatalf("missing: %v, %v", ok, err)
		}
		return nil
	})
}

func TestSchedulesJoinsLiveWordsAndStates(t *testing.T) {
	newTestDB(t)
	seedWord(t, "w1", "cat", false)
	seedWord(t, "w2", "dog", false)
	seedWord(t, "w3", "owl", true)
	at := time.UnixMilli(1_700_000_000_000)
	if err := sqlitex.DB.Create(&repo.UserDict{UserId: "u1", WordId: "w1", QueryCount: 2, UpdatedAt: at.UnixMilli()}).Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Create(&repo.UserDict{UserId: "u1", WordId: "w2", QueryCount: 1, Known: true, UpdatedAt: at.UnixMilli()}).Error; err != nil {
		t.Fatal(err)
	}
	if err := sqlitex.DB.Create(&repo.UserDict{UserId: "u1", WordId: "w3", QueryCount: 4, UpdatedAt: at.UnixMilli()}).Error; err != nil {
		t.Fatal(err)
	}
	inTx(t, func(tx review.Tx) error {
		return tx.SaveState(review.State{UserID: "u1", WordID: "w1", Stability: 1, Difficulty: 5, Phase: 2,
			Due: at.Add(24 * time.Hour), LastReview: at, Reps: 1})
	})

	got, err := (Store{}).Schedules(context.Background(), "u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("rows %+v, want w1 and w2 only", got)
	}
	byID := map[string]review.ScheduleRow{}
	for _, row := range got {
		byID[row.WordID] = row
	}
	if row := byID["w1"]; row.English != "cat" || row.QueryCount != 2 || row.State == nil || row.State.Reps != 1 {
		t.Fatalf("w1 %+v", row)
	}
	if row := byID["w2"]; row.English != "dog" || !row.Known || row.State != nil {
		t.Fatalf("w2 %+v", row)
	}
}
