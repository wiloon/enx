package enx

import "testing"

func TestGetOrCreateByCognitoSub_EmptySub(t *testing.T) {
	_, err := GetOrCreateByCognitoSub("", "a@b.com", "alice")
	if err == nil {
		t.Fatal("expected error for empty sub")
	}
}
