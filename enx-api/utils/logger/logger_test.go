package logger

import (
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// This test must run before any test that calls Init, since sugaredLogger
// is a package-level var that, once set, is never nil again for the rest
// of the test binary.
func TestGetLoggerDefaultsBeforeInit(t *testing.T) {
	l := GetLogger()
	if l == nil {
		t.Fatal("expected a non-nil default logger before Init is called")
	}

	// None of these should panic.
	l.Debug("debug", "args")
	l.Debugf("debug %s", "fmt")
	l.Info("info", "args")
	l.Infof("info %s", "fmt")
	l.Warn("warn", "args")
	l.Warnf("warn %s", "fmt")
	l.Error("error", "args")
	l.Errorf("error %s", "fmt")
	l.Fatal("fatal", "args")
	l.Fatalf("fatal %s", "fmt")
	l.Panic("panic", "args")
	l.Panicf("panic %s", "fmt")

	Debug("debug")
	Debugf("debug %s", "fmt")
	Info("info")
	Infof("info %s", "fmt")
	Warn("warn")
	Warnf("warn %s", "fmt")
	Error("error")
	Errorf("error %s", "fmt")
}

func TestDefaultLoggerSyncPanics(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected the default logger's Sync to panic (not implemented)")
		}
	}()
	_ = GetLogger().Sync()
}

// A mistyped LOG_LEVEL must not leave the service on the unlevelled stdlib
// logger (which prints everything): it falls back to info.
func TestInitWithInvalidLevelFallsBackToInfo(t *testing.T) {
	Init("CONSOLE", "not-a-real-level", "enx-api-test")

	assertLevel(t, zap.InfoLevel)
}

func TestInitAppliesTheLevel(t *testing.T) {
	Init("CONSOLE", "warn", "enx-api-test")

	assertLevel(t, zap.WarnLevel)
}

func assertLevel(t *testing.T, want zapcore.Level) {
	t.Helper()
	sugar, ok := GetLogger().(*zap.SugaredLogger)
	if !ok {
		t.Fatalf("GetLogger() = %T, want the zap logger", GetLogger())
	}
	core := sugar.Desugar().Core()
	if !core.Enabled(want) || (want > zapcore.DebugLevel && core.Enabled(want-1)) {
		t.Fatalf("logger is not at %s", want)
	}
}

func TestInitWithValidLevel(t *testing.T) {
	Init("CONSOLE", "info", "enx-api-test")

	l := GetLogger()
	if _, ok := l.(*defaultLogger); ok {
		t.Fatal("expected Init to replace the default logger with a zap-backed one")
	}

	// None of these should panic now that a real logger is wired up.
	l.Debug("debug", "args")
	l.Debugf("debug %s", "fmt")
	l.Info("info", "args")
	l.Infof("info %s", "fmt")
	l.Warn("warn", "args")
	l.Warnf("warn %s", "fmt")
	l.Error("error", "args")
	l.Errorf("error %s", "fmt")

	Debug("debug")
	Debugf("debug %s", "fmt")
	Info("info")
	Infof("info %s", "fmt")
	Warn("warn")
	Warnf("warn %s", "fmt")
	Error("error")
	Errorf("error %s", "fmt")

	// Sync on a zap sugared logger returns (and package Sync swallows) an
	// error on stdout rather than panicking.
	Sync()
}

func TestInitWithEmptyToDefaultsToConsole(t *testing.T) {
	Init("", "info", "enx-api-test")
	if _, ok := GetLogger().(*defaultLogger); ok {
		t.Fatal("expected an empty `to` to still initialize a zap-backed logger via the console branch")
	}
}
