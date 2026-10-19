package account

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestEmailHMACIgnoresCaseAndSurroundingSpace(t *testing.T) {
	h := NewEmailHMAC("k")
	want := h.Of("alice@example.com")
	for _, email := range []string{"Alice@Example.com", "  alice@example.com\t", "ALICE@EXAMPLE.COM "} {
		if got := h.Of(email); got != want {
			t.Errorf("Of(%q) = %q, want %q", email, got, want)
		}
	}
}

func TestEmailHMACIsKeyedSHA256OfTheNormalizedEmail(t *testing.T) {
	mac := hmac.New(sha256.New, []byte("k"))
	mac.Write([]byte("alice@example.com"))
	want := hex.EncodeToString(mac.Sum(nil))
	if got := NewEmailHMAC("k").Of(" Alice@example.com"); got != want {
		t.Fatalf("Of = %q, want %q", got, want)
	}
	if NewEmailHMAC("other").Of("alice@example.com") == want {
		t.Fatal("a different key must give a different HMAC")
	}
}

func TestEmailHMACOfAnEmptyEmailIsEmpty(t *testing.T) {
	if got := NewEmailHMAC("k").Of("   "); got != "" {
		t.Fatalf("Of(blank) = %q, want empty", got)
	}
}

func TestEmailHMACWithoutAKeyIsEmpty(t *testing.T) {
	h := NewEmailHMAC("")
	if h.Configured() {
		t.Fatal("an empty key must not count as configured")
	}
	if got := h.Of("alice@example.com"); got != "" {
		t.Fatalf("Of without a key = %q, want empty", got)
	}
}
