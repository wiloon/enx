package enx

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
)

// newProductionUserDB opens a temp-file database with the production pragmas
// (WAL, busy_timeout, _txlock=immediate) and schema.
func newProductionUserDB(t *testing.T) *gorm.DB {
	t.Helper()
	if err := sqlitex.InitWithLogLevel(filepath.Join(t.TempDir(), "enx.db"), "warn"); err != nil {
		t.Fatal(err)
	}
	db := sqlitex.DB
	t.Cleanup(func() {
		if raw, err := db.DB(); err == nil {
			_ = raw.Close()
		}
	})
	return db
}

type racingWinner struct {
	id, clerkUserID, email, status string
}

// insertWinnerBeforeCreate makes the first INSERT into users find a row the
// "winner" request has just stored for the same Clerk user id. The winner is
// written on the loser's own transaction, so the conflict is deterministic.
func insertWinnerBeforeCreate(t *testing.T, db *gorm.DB, w racingWinner) {
	t.Helper()
	done := false
	err := db.Callback().Create().Before("gorm:create").Register("test:insert_winner", func(tx *gorm.DB) {
		if done || tx.Statement.Table != "users" {
			return
		}
		done = true
		now := time.Now()
		if err := tx.Session(&gorm.Session{NewDB: true}).Exec(
			`INSERT INTO users (id, clerk_user_id, name, email, status, created_at, updated_at, last_login_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			w.id, w.clerkUserID, "Winner", w.email, w.status, now, now, now,
		).Error; err != nil {
			t.Errorf("insert winner: %v", err)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
}

// afterCreate runs fn once, right after the loser's INSERT and before its
// transaction commits.
func afterCreate(t *testing.T, db *gorm.DB, fn func(tx *gorm.DB)) {
	t.Helper()
	done := false
	err := db.Callback().Create().After("gorm:create").Register("test:after_create", func(tx *gorm.DB) {
		if done || tx.Statement.Table != "users" {
			return
		}
		done = true
		fn(tx)
	})
	if err != nil {
		t.Fatal(err)
	}
}

func countUsers(t *testing.T) int64 {
	t.Helper()
	var n int64
	if err := sqlitex.DB.Raw(`SELECT count(*) FROM users`).Scan(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

// #580: two first requests of a new Clerk user race; the one whose insert
// loses carries on as the user the winner created.
func TestGetOrCreateClerkUser_LostInsertReturnsTheWinnersRow(t *testing.T) {
	db := newProductionUserDB(t)
	hook := &recordingHook{}
	withNewUserHook(t, hook)
	insertWinnerBeforeCreate(t, db, racingWinner{id: "winner-id", clerkUserID: "user_race", email: "winner@example.com", status: "disabled"})

	got, err := GetOrCreateClerkUser("user_race", ClerkProfile{Email: "token@example.com"}, time.Nanosecond)
	if err != nil {
		t.Fatalf("lost insert failed the request: %v", err)
	}
	if got.Id != "winner-id" || got.Status != "disabled" {
		t.Fatalf("returned id=%q status=%q, want the winner's winner-id disabled", got.Id, got.Status)
	}
	if n := countUsers(t); n != 1 {
		t.Fatalf("%d users rows, want 1", n)
	}
	if len(hook.userIDs) != 0 {
		t.Fatalf("hook ran for the loser: %v", hook.userIDs)
	}
}

// The loser applies the existing-user profile sync (ADR-015, 2026-10-20
// note §2) to the winner's row.
func TestGetOrCreateClerkUser_LostInsertSyncsTheProfile(t *testing.T) {
	db := newProductionUserDB(t)
	insertWinnerBeforeCreate(t, db, racingWinner{id: "winner-id", clerkUserID: "user_race", email: "winner@example.com", status: "disabled"})

	got, err := GetOrCreateClerkUser("user_race", ClerkProfile{Email: "token@example.com"}, time.Nanosecond)
	if err != nil {
		t.Fatalf("lost insert failed the request: %v", err)
	}
	if got.Email != "token@example.com" {
		t.Fatalf("returned email = %q, want the token's", got.Email)
	}
	if stored := GetUserByID("winner-id"); stored.Email != "token@example.com" {
		t.Fatalf("stored email = %q, want the token's", stored.Email)
	}
}

func TestGetOrCreateClerkUser_LostInsertWithTheRowGoneIsNotFound(t *testing.T) {
	db := newProductionUserDB(t)
	insertWinnerBeforeCreate(t, db, racingWinner{id: "winner-id", clerkUserID: "user_race", email: "winner@example.com", status: "active"})
	afterCreate(t, db, func(tx *gorm.DB) {
		if err := tx.Session(&gorm.Session{NewDB: true}).Exec(`DELETE FROM users WHERE id = ?`, "winner-id").Error; err != nil {
			t.Errorf("delete winner: %v", err)
		}
	})

	got, err := GetOrCreateClerkUser("user_race", ClerkProfile{Email: "token@example.com"}, time.Nanosecond)
	if got != nil {
		t.Fatalf("returned user %+v, want none", got)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("err = %v, want gorm.ErrRecordNotFound", err)
	}
}

// blockingHook writes a row through the provisioning transaction, then waits
// for release before it returns.
type blockingHook struct {
	entered chan struct{}
	release chan struct{}
	calls   atomic.Int32
}

func (h *blockingHook) NewUser(_ context.Context, tx *gorm.DB, userID, _ string) (func(), error) {
	h.calls.Add(1)
	if err := tx.Exec(`INSERT INTO hook_writes (user_id) VALUES (?)`, userID).Error; err != nil {
		return nil, err
	}
	close(h.entered)
	<-h.release
	return nil, nil
}

type provisioned struct {
	user *User
	err  error
}

// #596: a concurrent first request of the same Clerk user sees no user until
// the hook's writes commit with it, so it never reads a user without its
// sign-up trial.
func TestGetOrCreateClerkUser_ConcurrentFirstRequestWaitsForTheHook(t *testing.T) {
	db := newProductionUserDB(t)
	if err := db.Exec(`CREATE TABLE hook_writes (user_id TEXT)`).Error; err != nil {
		t.Fatal(err)
	}
	hook := &blockingHook{entered: make(chan struct{}), release: make(chan struct{})}
	withNewUserHook(t, hook)
	p := ClerkProfile{Email: "first@example.com"}

	first := make(chan provisioned, 1)
	go func() {
		u, err := GetOrCreateClerkUser("user_blocked", p, time.Hour)
		first <- provisioned{u, err}
	}()
	select {
	case <-hook.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the hook never ran")
	}
	second := make(chan provisioned, 1)
	go func() {
		u, err := GetOrCreateClerkUser("user_blocked", p, time.Hour)
		second <- provisioned{u, err}
	}()

	select {
	case got := <-second:
		close(hook.release)
		t.Fatalf("second request returned %+v while the hook was still running", got)
	case <-time.After(300 * time.Millisecond):
	}
	close(hook.release)

	a, b := <-first, <-second
	if a.err != nil || b.err != nil {
		t.Fatalf("errors: first=%v second=%v", a.err, b.err)
	}
	if a.user.Id != b.user.Id {
		t.Fatalf("user ids differ: first=%s second=%s", a.user.Id, b.user.Id)
	}
	var written int64
	if err := sqlitex.DB.Raw(`SELECT count(*) FROM hook_writes WHERE user_id = ?`, a.user.Id).Scan(&written).Error; err != nil {
		t.Fatal(err)
	}
	if written != 1 || hook.calls.Load() != 1 {
		t.Fatalf("hook rows = %d, hook calls = %d; want the one write of one call", written, hook.calls.Load())
	}
}

// rollbackHook makes the outer transaction's commit fail by rolling the
// transaction back underneath it, and returns an after-commit callback.
type rollbackHook struct{ called bool }

func (h *rollbackHook) NewUser(_ context.Context, tx *gorm.DB, _, _ string) (func(), error) {
	if err := tx.Statement.ConnPool.(gorm.TxCommitter).Rollback(); err != nil {
		return nil, err
	}
	return func() { h.called = true }, nil
}

func TestGetOrCreateClerkUser_FailedCommitSkipsTheAfterCommitCallback(t *testing.T) {
	newProductionUserDB(t)
	hook := &rollbackHook{}
	withNewUserHook(t, hook)

	got, err := GetOrCreateClerkUser("user_commit_fails", ClerkProfile{Email: "c@example.com"}, time.Hour)
	if !errors.Is(err, sql.ErrTxDone) || got != nil {
		t.Fatalf("got user %+v, err %v; want no user and sql.ErrTxDone", got, err)
	}
	if hook.called {
		t.Fatal("after-commit callback ran although the commit failed")
	}
	if n := countUsers(t); n != 0 {
		t.Fatalf("%d users rows, want none", n)
	}
}

func TestGetOrCreateClerkUser_LostInsertWithAFailedReReadKeepsTheCause(t *testing.T) {
	db := newProductionUserDB(t)
	insertWinnerBeforeCreate(t, db, racingWinner{id: "winner-id", clerkUserID: "user_race", email: "winner@example.com", status: "active"})
	readDown := errors.New("read failed")
	armed := false
	afterCreate(t, db, func(*gorm.DB) { armed = true })
	err := db.Callback().Query().Before("gorm:query").Register("test:fail_reread", func(tx *gorm.DB) {
		if armed && tx.Statement.Table == "users" {
			armed = false
			_ = tx.AddError(readDown)
		}
	})
	if err != nil {
		t.Fatal(err)
	}

	got, err := GetOrCreateClerkUser("user_race", ClerkProfile{Email: "token@example.com"}, time.Nanosecond)
	if got != nil {
		t.Fatalf("returned user %+v, want none", got)
	}
	if !errors.Is(err, readDown) {
		t.Fatalf("err = %v, want it to wrap %v", err, readDown)
	}
}
