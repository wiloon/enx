package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
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

// The E2E stack uses the real executable and a local Stripe HTTP adapter.
func TestMain_LocalStripeBecomesReady(t *testing.T) {
	accountRead := make(chan struct{}, 1)
	stripeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet && r.URL.Path == "/v1/account" {
			select {
			case accountRead <- struct{}{}:
			default:
			}
			_, _ = w.Write([]byte(`{"id":"acct_e2e","object":"account"}`))
			return
		}
		http.Error(w, `{"error":{"message":"unsupported local Stripe request"}}`, http.StatusNotImplemented)
	}))
	defer stripeServer.Close()
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(cfgPath, []byte("[stripe]\napi-base-url = \""+stripeServer.URL+"\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^$")
	cmd.Env = append(os.Environ(), runMainEnv+"=1", "ENX_API_TEST_CONFIG="+cfgPath,
		"DB_PATH="+filepath.Join(dir, "enx.db"), "ENX_PORT="+strconv.Itoa(port),
		"METRICS_ADDR=127.0.0.1:0", "STRIPE_SECRET_KEY=sk_test_local_e2e",
		"STRIPE_WEBHOOK_SECRET=whsec_local_e2e")
	logFile, err := os.Create(filepath.Join(dir, "startup.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer logFile.Close()
	cmd.Stdout, cmd.Stderr = logFile, logFile
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { cancel(); _ = cmd.Wait() }()
	client := &http.Client{Timeout: time.Second}
	for {
		response, err := client.Get("http://127.0.0.1:" + strconv.Itoa(port) + "/api/version")
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				break
			}
		}
		select {
		case <-ctx.Done():
			output, _ := os.ReadFile(logFile.Name())
			t.Fatalf("API did not become ready with local Stripe: %s", output)
		case <-time.After(50 * time.Millisecond):
		}
	}
	select {
	case <-accountRead:
	case <-ctx.Done():
		t.Fatal("Stripe account discovery did not reach the local adapter")
	}
}
