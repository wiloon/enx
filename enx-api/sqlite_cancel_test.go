//go:build integration

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
// functions. The functions are registered once, driver-wide. Each run installs
// its own completion channel and may wait for cancellation in probe_start.
var cancelProbe struct {
	mu      sync.Mutex
	onStart func()
	done    chan struct{}
}

var registerCancelProbe sync.Once

// registerCancelProbeFuncs must run before a connection opens: the driver
// applies registered functions to connections as they are created.
func registerCancelProbeFuncs() {
	registerCancelProbe.Do(func() {
		gosqlite.MustRegisterScalarFunction("probe_start", 0, func(*gosqlite.FunctionContext, []driver.Value) (driver.Value, error) {
			cancelProbe.mu.Lock()
			onStart := cancelProbe.onStart
			cancelProbe.mu.Unlock()
			if onStart != nil {
				onStart()
			}
			return int64(1), nil
		})
		gosqlite.MustRegisterScalarFunction("probe_done", 1, func(_ *gosqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			cancelProbe.mu.Lock()
			closeIfOpen(cancelProbe.done)
			cancelProbe.mu.Unlock()
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

// runCancelScenario runs stmt with a live context. With cancelMidway,
// probe_start signals from inside the SQLite step and waits for cancellation
// before allowing that step to proceed.
func runCancelScenario(t *testing.T, cancelMidway bool, stmt func(ctx context.Context) error) cancelOutcome {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	started, done := make(chan struct{}), make(chan struct{})
	cancelProbe.mu.Lock()
	cancelProbe.done = done
	cancelProbe.onStart = nil
	if cancelMidway {
		cancelProbe.onStart = func() {
			closeIfOpen(started)
			<-ctx.Done()
		}
	}
	cancelProbe.mu.Unlock()

	returned := make(chan error, 1)
	begin := time.Now()
	go func() { returned <- stmt(ctx) }()

	if cancelMidway {
		select {
		case <-started:
			cancel()
		case err := <-returned:
			t.Fatalf("statement returned before reaching probe_start: %v", err)
		case <-time.After(30 * time.Second):
			t.Fatal("SQLite never reached probe_start")
		}
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

// probedAggregate runs a finite recursive CTE between the two probes and
// returns one row. SQLite must do all the work in a single step.
const probedAggregate = `WITH RECURSIVE c(n) AS (
    SELECT probe_start()
    UNION ALL SELECT n+1 FROM c WHERE n < 2000000
) SELECT probe_done(max(n)) AS n FROM c`

// execStatement mirrors reader.PurgeExpired: a DELETE through WithContext.
func execStatement(db *gorm.DB) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		return db.WithContext(ctx).Where("id = (" + probedAggregate + ")").Delete(&cancelJob{}).Error
	}
}

// queryStatement mirrors credit.ExpireTrials's Pluck. Both probes run within
// the first Next call, before database/sql can stop requesting rows.
func queryStatement(db *gorm.DB) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		var ids []int64
		return db.WithContext(ctx).Raw(probedAggregate).Pluck("n", &ids).Error
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
	if got.completed {
		t.Error("SQLite finished the DELETE workload after cancellation")
	}
	assertCancelError(t, got.err, false)
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
	if !got.completed {
		t.Error("SQLite did not finish the active query step after cancellation")
	}
	assertCancelError(t, got.err, true)
}

func assertCancelError(t *testing.T, err error, wantIsCanceled bool) {
	t.Helper()
	if err == nil {
		t.Fatal("statement returned without an error after cancellation")
	}
	if is := errors.Is(err, context.Canceled); is != wantIsCanceled {
		t.Errorf("errors.Is(err, context.Canceled) = %v, want %v (err: %v)", is, wantIsCanceled, err)
	}
}
