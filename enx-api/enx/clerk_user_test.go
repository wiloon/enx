package enx

import "testing"

func TestGetOrCreateByClerkUserID_EmptyID(t *testing.T) {
	_, err := GetOrCreateByClerkUserID("", "a@b.com", "alice")
	if err == nil {
		t.Fatal("expected error for empty clerk user id")
	}
}
