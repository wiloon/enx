package main

import (
	"context"
	"database/sql/driver"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	gosqlite "github.com/glebarez/go-sqlite"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// The periodic jobs pass their shutdown context to GORM (reader.PurgeExpired
// runs a DELETE, credit.ExpireTrials a Pluck). These tests characterize what
// the driver does when that context is cancelled while SQLite is mid-statement,
// so logJobFailure's reliance on errors.Is(err, context.Canceled) is checked
// against the real driver rather than assumed.

// cancelProbe lets a test observe SQLite evaluating its test-only scalar
// functions. The functions are registered once, driver-wide; each run installs
// its own channels.
var cancelProbe struct {
	mu      sync.Mutex
	started chan struct{}
	done    chan struct{}
}

var registerCancelProbe sync.Once

// installCancelProbe returns a channel closed when SQLite first evaluates
// probe_start() and one closed when it evaluates probe_done(), which the
// statements place after the expensive part.
func installCancelProbe() (started, done <-chan struct{}) {
	registerCancelProbeFuncs()
	s, d := make(chan struct{}), make(chan struct{})
	cancelProbe.mu.Lock()
	cancelProbe.started, cancelProbe.done = s, d
	cancelProbe.mu.Unlock()
	return s, d
}

// registerCancelProbeFuncs must run before a connection opens: the driver
// applies registered functions to connections as they are created.
func registerCancelProbeFuncs() {
	registerCancelProbe.Do(func() {
		fire := func(pick func() chan struct{}) {
			cancelProbe.mu.Lock()
			defer cancelProbe.mu.Unlock()
			if c := pick(); c != nil {
				select {
				case <-c:
				default:
					close(c)
				}
			}
		}
		gosqlite.MustRegisterScalarFunction("probe_start", 0, func(*gosqlite.FunctionContext, []driver.Value) (driver.Value, error) {
			fire(func() chan struct{} { return cancelProbe.started })
			return int64(1), nil
		})
		gosqlite.MustRegisterScalarFunction("probe_done", 1, func(_ *gosqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			fire(func() chan struct{} { return cancelProbe.done })
			return args[0], nil
		})
	})
}

type cancelJob struct {
	ID int64 `gorm:"primaryKey"`
}

func openCancelDB(t *testing.T) *gorm.DB {
	t.Helper()
	registerCancelProbeFuncs()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "cancel.db")), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&cancelJob{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&cancelJob{ID: 1}).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

// cancelOutcome is what one run of a statement reported.
type cancelOutcome struct {
	err       error
	completed bool // SQLite reached probe_done, i.e. the expensive part finished
	elapsed   time.Duration
}

// runCancelScenario runs stmt with a live context. With cancelMidway it
// cancels only after SQLite has signalled from inside the statement. A
// watchdog fails the test if the statement never returns.
func runCancelScenario(t *testing.T, cancelMidway bool, stmt func(ctx context.Context) error) cancelOutcome {
	t.Helper()
	started, done := installCancelProbe()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	returned := make(chan error, 1)
	begin := time.Now()
	go func() { returned <- stmt(ctx) }()

	if cancelMidway {
		select {
		case <-started:
		case <-time.After(30 * time.Second):
			t.Fatal("SQLite never signalled from inside the statement")
		}
		cancel()
	}

	var err error
	select {
	case err = <-returned:
	case <-time.After(60 * time.Second):
		t.Fatal("statement did not return")
	}
	out := cancelOutcome{err: err, elapsed: time.Since(begin)}
	select {
	case <-done:
		out.completed = true
	default:
	}
	return out
}

// execStatement mirrors reader.PurgeExpired: a DELETE through WithContext.
// The subquery counts a recursive CTE (the expensive part) and only then
// calls probe_done, so probe_start fires before the work and probe_done after.
func execStatement(db *gorm.DB) func(ctx context.Context) error {
	const expensive = `(SELECT probe_done(n) FROM (WITH RECURSIVE c(n) AS (SELECT probe_start() UNION ALL SELECT n+1 FROM c WHERE n < 2000000) SELECT max(n) AS n FROM c))`
	return func(ctx context.Context) error {
		return db.WithContext(ctx).Where("id = " + expensive).Delete(&cancelJob{}).Error
	}
}

// queryStatement mirrors credit.ExpireTrials's Pluck: SQLite produces the rows
// lazily, so the work happens while database/sql iterates them.
func queryStatement(db *gorm.DB) func(ctx context.Context) error {
	const q = `SELECT CASE WHEN n = 1 THEN probe_start() + n - 1 WHEN n = 2000000 THEN probe_done(n) ELSE n END FROM (WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c WHERE n < 2000000) SELECT n FROM c)`
	return func(ctx context.Context) error {
		var ids []int64
		return db.WithContext(ctx).Raw(q).Pluck("n", &ids).Error
	}
}

func TestSQLiteExecCancellation(t *testing.T) {
	db := openCancelDB(t)
	stmt := execStatement(db)

	base := runCancelScenario(t, false, stmt)
	if base.err != nil || !base.completed {
		t.Fatalf("uncancelled run: err=%v completed=%v, want nil and true", base.err, base.completed)
	}

	got := runCancelScenario(t, true, stmt)
	t.Logf("exec: baseline %s; cancelled run %s, err=%v, completed=%v, Is(Canceled)=%v",
		base.elapsed, got.elapsed, got.err, got.completed, errors.Is(got.err, context.Canceled))
	assertCancelOutcome(t, got, false)
}

func TestSQLiteQueryCancellation(t *testing.T) {
	db := openCancelDB(t)
	stmt := queryStatement(db)

	base := runCancelScenario(t, false, stmt)
	if base.err != nil || !base.completed {
		t.Fatalf("uncancelled run: err=%v completed=%v, want nil and true", base.err, base.completed)
	}

	got := runCancelScenario(t, true, stmt)
	t.Logf("query: baseline %s; cancelled run %s, err=%v, completed=%v, Is(Canceled)=%v",
		base.elapsed, got.elapsed, got.err, got.completed, errors.Is(got.err, context.Canceled))
	assertCancelOutcome(t, got, true)
}

// assertCancelOutcome pins what the driver does today: in both paths the
// in-flight work is interrupted before it reaches probe_done and the caller
// gets an error. Only the Query path surfaces context.Canceled; the Exec path
// returns SQLite's "interrupted (9)", which is why logJobFailure also checks
// the job's context.
func assertCancelOutcome(t *testing.T, got cancelOutcome, wantIsCanceled bool) {
	t.Helper()
	if got.completed {
		t.Error("in-flight SQLite work ran to completion; want it interrupted")
	}
	if got.err == nil {
		t.Fatal("statement returned without an error after cancellation")
	}
	if is := errors.Is(got.err, context.Canceled); is != wantIsCanceled {
		t.Errorf("errors.Is(err, context.Canceled) = %v, want %v (err: %v)", is, wantIsCanceled, got.err)
	}
}
