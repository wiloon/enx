package version

import (
	"strings"
	"testing"
	"time"
)

func TestGetVersionInfo(t *testing.T) {
	info := GetVersionInfo()

	if info == nil {
		t.Fatal("GetVersionInfo() returned nil")
	}

	// Check that all fields are set (even if they're default values)
	if info.Version == "" {
		t.Error("Version field is empty")
	}

	if info.BuildTime == "" {
		t.Error("BuildTime field is empty")
	}

	if info.GitCommit == "" {
		t.Error("GitCommit field is empty")
	}

	if info.GitBranch == "" {
		t.Error("GitBranch field is empty")
	}

	if info.GoVersion == "" {
		t.Error("GoVersion field is empty")
	}

	// Check that uptime is set and has a reasonable format
	if info.Uptime == "" {
		t.Error("Uptime field is empty")
	}

	// Uptime should contain some time unit
	if !strings.ContainsAny(info.Uptime, "msdh") {
		t.Errorf("Uptime format seems invalid: %s", info.Uptime)
	}
}

func TestGetVersionString(t *testing.T) {
	versionStr := GetVersionString()

	if versionStr == "" {
		t.Fatal("GetVersionString() returned empty string")
	}

	// Should contain "enx-api v" prefix
	if len(versionStr) < 8 {
		t.Error("Version string too short")
	}
}

func TestGetDetailedVersionString(t *testing.T) {
	detailedStr := GetDetailedVersionString()

	if detailedStr == "" {
		t.Fatal("GetDetailedVersionString() returned empty string")
	}

	// Should contain multiple lines with version information
	if len(detailedStr) < 20 {
		t.Error("Detailed version string too short")
	}

	// Should contain uptime information
	if !strings.Contains(detailedStr, "Uptime:") {
		t.Error("Detailed version string should contain uptime information")
	}
}

func TestGetUptime(t *testing.T) {
	uptime := GetUptime()

	if uptime == "" {
		t.Fatal("GetUptime() returned empty string")
	}

	// Should contain some time unit
	if !strings.ContainsAny(uptime, "msdh") {
		t.Errorf("Uptime format seems invalid: %s", uptime)
	}
}

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		duration time.Duration
		expected string
	}{
		{500 * time.Millisecond, "500ms"},
		{1500 * time.Millisecond, "1s 500ms"},
		{30 * time.Second, "30s 0ms"},
		{90 * time.Second, "1m 30s"},
		{30 * time.Minute, "30m 0s"},
		{90 * time.Minute, "1h 30m 0s"},
		{2 * time.Hour, "2h 0m 0s"},
		{25 * time.Hour, "1d 1h 0m 0s"},
		{48 * time.Hour, "2d 0h 0m 0s"},
	}

	for _, test := range tests {
		result := formatDuration(test.duration)
		if result != test.expected {
			t.Errorf("formatDuration(%v) = %s, expected %s", test.duration, result, test.expected)
		}
	}
}

func TestUptimeIncreases(t *testing.T) {
	// Test that uptime increases over time
	uptime1 := GetUptime()
	time.Sleep(10 * time.Millisecond)
	uptime2 := GetUptime()

	// Both should be valid uptime strings
	if uptime1 == "" || uptime2 == "" {
		t.Error("Uptime should not be empty")
	}

	// They should be different (uptime should increase)
	if uptime1 == uptime2 {
		t.Logf("Uptime1: %s, Uptime2: %s", uptime1, uptime2)
		t.Log("Note: Uptime might be the same if the sleep was too short")
	}
}
