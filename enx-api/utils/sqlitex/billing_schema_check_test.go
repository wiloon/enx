package sqlitex

import (
	"path/filepath"
	"testing"
)

// initializedDatabase creates a current-schema database at a fresh path and
// closes it, so the file can be inspected and reopened.
func initializedDatabase(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "billing.db")
	previous := DB
	t.Cleanup(func() { DB = previous })
	if err := InitWithLogLevel(path, "error"); err != nil {
		t.Fatal(err)
	}
	raw, err := DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCheckBillingSchemaAcceptsAnInitializedDatabase(t *testing.T) {
	path := initializedDatabase(t)

	if err := CheckBillingSchema(path); err != nil {
		t.Fatalf("CheckBillingSchema = %v, want nil for a current schema", err)
	}
}
