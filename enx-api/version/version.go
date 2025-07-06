package version

import (
	"fmt"
	"runtime"
	"time"
)

// These variables will be injected at compile time via ldflags
var (
	// Version version number, e.g. "1.0.0"
	Version = "dev"
	// BuildTime build timestamp
	BuildTime = "unknown"
	// GitCommit Git commit hash
	GitCommit = "unknown"
	// GitBranch Git branch name
	GitBranch = "unknown"
	// GoVersion Go runtime version
	GoVersion = runtime.Version()
)

// StartTime records when the application started
var StartTime = time.Now()

// Info version information structure
type Info struct {
	Version   string `json:"version"`
	BuildTime string `json:"build_time"`
	GitCommit string `json:"git_commit"`
	GitBranch string `json:"git_branch"`
	GoVersion string `json:"go_version"`
	Uptime    string `json:"uptime,omitempty"`
}

// GetUptime returns formatted uptime string with automatic unit conversion
func GetUptime() string {
	duration := time.Since(StartTime)
	return formatDuration(duration)
}

// formatDuration formats duration with automatic unit conversion
// Precision: milliseconds for short durations, seconds for longer ones
func formatDuration(d time.Duration) string {
	// Less than 1 second: show milliseconds
	if d < time.Second {
		return fmt.Sprintf("%dms", d.Milliseconds())
	}

	// Less than 1 minute: show seconds with milliseconds
	if d < time.Minute {
		seconds := int(d.Seconds())
		milliseconds := int(d.Milliseconds()) % 1000
		return fmt.Sprintf("%ds %dms", seconds, milliseconds)
	}

	// Less than 1 hour: show minutes and seconds
	if d < time.Hour {
		minutes := int(d.Minutes())
		seconds := int(d.Seconds()) % 60
		return fmt.Sprintf("%dm %ds", minutes, seconds)
	}

	// Less than 1 day: show hours, minutes and seconds
	if d < 24*time.Hour {
		hours := int(d.Hours())
		minutes := int(d.Minutes()) % 60
		seconds := int(d.Seconds()) % 60
		return fmt.Sprintf("%dh %dm %ds", hours, minutes, seconds)
	}

	// More than 1 day: show days, hours, minutes and seconds
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60
	seconds := int(d.Seconds()) % 60
	return fmt.Sprintf("%dd %dh %dm %ds", days, hours, minutes, seconds)
}

// GetVersionInfo returns version information
func GetVersionInfo() *Info {
	return &Info{
		Version:   Version,
		BuildTime: BuildTime,
		GitCommit: GitCommit,
		GitBranch: GitBranch,
		GoVersion: GoVersion,
		Uptime:    GetUptime(),
	}
}

// GetVersionString returns version string
func GetVersionString() string {
	return fmt.Sprintf("enx-api v%s (%s)", Version, GitCommit)
}

// GetDetailedVersionString returns detailed version string
func GetDetailedVersionString() string {
	return fmt.Sprintf("enx-api v%s\nBuild Time: %s\nGit Commit: %s\nGit Branch: %s\nGo Version: %s\nUptime: %s",
		Version, BuildTime, GitCommit, GitBranch, GoVersion, GetUptime())
}
