package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func sqlStatements(t *testing.T, name string) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata/billing-legacy", name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var lines []string
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			lines = append(lines, line)
		}
	}
	var statements []string
	for _, s := range strings.Split(strings.Join(lines, "\n"), ";") {
		if s = strings.TrimSpace(s); s != "" {
			statements = append(statements, s)
		}
	}
	return statements
}
