package logger

import (
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

// observe routes the package-level functions to an in-memory zap core for
// the duration of the test.
func observe(t *testing.T) *observer.ObservedLogs {
	t.Helper()
	core, logs := observer.New(zap.DebugLevel)
	prev := sugaredLogger
	sugaredLogger = zap.New(core).Sugar()
	t.Cleanup(func() { sugaredLogger = prev })
	return logs
}

func TestWarnfLogsAtWarnLevel(t *testing.T) {
	logs := observe(t)

	Warnf("quota store %s", "slow")

	entries := logs.All()
	if len(entries) != 1 || entries[0].Level != zap.WarnLevel || entries[0].Message != "quota store slow" {
		t.Fatalf("got %+v, want one warn-level entry", entries)
	}
}

func TestInfowLogsStructuredFields(t *testing.T) {
	logs := observe(t)

	Infow("request", "route", "/api/word/:word", "status", 200)

	entries := logs.All()
	if len(entries) != 1 || entries[0].Level != zap.InfoLevel || entries[0].Message != "request" {
		t.Fatalf("got %+v, want one info-level entry", entries)
	}
	fields := entries[0].ContextMap()
	if fields["route"] != "/api/word/:word" || fields["status"] != int64(200) {
		t.Fatalf("fields = %+v", fields)
	}
}
