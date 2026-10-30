package main

import (
	"context"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// runMainEnv makes the test binary run main() instead of the tests, so a
// test can watch the real process start (and stop).
const runMainEnv = "ENX_API_TEST_RUN_MAIN"

func TestMain(m *testing.M) {
	if os.Getenv(runMainEnv) == "1" {
		os.Args = []string{"enx-api", "-c", os.Getenv("ENX_API_TEST_CONFIG")}
		main()
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// #211: a database that fails to initialise (here, a users table whose
// uniqueness the rebuild refuses to guess at) stops the process with status
// 1 before anything is served.
func TestMain_DatabaseInitFailureExitsBeforeServing(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "enx.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		"CREATE TABLE users (id TEXT PRIMARY KEY, clerk_user_id TEXT, name TEXT UNIQUE, email TEXT, status TEXT)",
		"CREATE UNIQUE INDEX idx_users_email_live ON users(email) WHERE status = 'active'",
	} {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	if sqlDB, err := db.DB(); err == nil {
		_ = sqlDB.Close()
	}
	cfgPath := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(cfgPath, nil, 0o644); err != nil {
		t.Fatal(err)
	}

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	_ = l.Close()

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^$")
	cmd.Env = append(os.Environ(),
		runMainEnv+"=1",
		"ENX_API_TEST_CONFIG="+cfgPath,
		"DB_PATH="+dbPath,
		"LOG_LEVEL=info",
		"ENX_PORT="+strconv.Itoa(port),
		"METRICS_ADDR=127.0.0.1:0",
	)
	out, err := cmd.CombinedOutput()

	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 1 {
		t.Fatalf("process ended with %v, want exit status 1; output:\n%s", err, out)
	}
	if !strings.Contains(string(out), "unsupported billing schema") {
		t.Fatalf("output does not name the initialisation error:\n%s", out)
	}
	if strings.Contains(string(out), "listening") || strings.Contains(string(out), "auto-migration") {
		t.Fatalf("the process went on past the failed initialisation:\n%s", out)
	}
}
