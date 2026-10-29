//go:build integration

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

// The executable must use the same cutover startup as the in-process tests.
// Hold the HTTP port so the executable reaches its listen-failure path.
// The serving tests separately observe cancellation and joining before return.
func TestMain_CutoverReachesListenerAndStopsOnListenFailure(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(cfgPath, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = listener.Close() }()
	port := listener.Addr().(*net.TCPAddr).Port
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^$")
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) }))
	defer proxy.Close()
	cmd.Dir = dir // Do not load a developer's .env or call real providers.
	cmd.Env = []string{
		"PATH=" + os.Getenv("PATH"), "HOME=" + os.Getenv("HOME"), "HTTPS_PROXY=" + proxy.URL,
		runMainEnv + "=1", "ENX_API_TEST_CONFIG=" + cfgPath,
		"DB_PATH=" + filepath.Join(dir, "billing.db"), "BILLING_CUTOVER=true",
		"STRIPE_SECRET_KEY=sk_test_startup", "STRIPE_WEBHOOK_SECRET=whsec_startup",
		"APP_FRONTEND_BASE_URL=https://app.example.test", "LOG_LEVEL=info",
		"ENX_PORT=" + strconv.Itoa(port), "METRICS_ADDR=127.0.0.1:0",
	}
	out, err := cmd.CombinedOutput()
	var exit *exec.ExitError
	if ctx.Err() != nil {
		t.Fatalf("startup did not stop: %v\n%s", ctx.Err(), out)
	}
	if !errors.As(err, &exit) || exit.ExitCode() != 1 {
		t.Fatalf("exit = %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "failed to listen") {
		t.Fatalf("did not reach listener:\n%s", out)
	}
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "billing.db")), &gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = sqlDB.Close() }()
	if !db.Migrator().HasTable("stripe_webhook_events") {
		t.Fatal("main did not run billing cutover migrations")
	}
}
