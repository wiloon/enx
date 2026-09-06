package password

import (
	"strings"
	"testing"
)

func TestHashAndVerifyPassword(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=2$") {
		t.Fatalf("unexpected hash format: %s", hash)
	}

	ok, err := VerifyPassword("correct horse battery staple", hash)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Error("expected the correct password to verify")
	}
}

func TestVerifyPasswordRejectsWrongPassword(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ok, err := VerifyPassword("wrong password", hash)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Error("expected the wrong password to fail verification")
	}
}

func TestHashPasswordProducesUniqueSalts(t *testing.T) {
	hash1, err := HashPassword("same password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	hash2, err := HashPassword("same password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if hash1 == hash2 {
		t.Error("expected two hashes of the same password to differ due to random salts")
	}

	// Both should still verify against the original password.
	for _, h := range []string{hash1, hash2} {
		ok, err := VerifyPassword("same password", h)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !ok {
			t.Errorf("expected hash %q to verify", h)
		}
	}
}

func TestVerifyPasswordInvalidHashFormat(t *testing.T) {
	cases := []string{
		"",
		"not-a-hash",
		"$argon2id$v=19$m=65536,t=3,p=2$only-four-parts",
	}
	for _, encodedHash := range cases {
		_, err := VerifyPassword("anything", encodedHash)
		if err == nil {
			t.Errorf("expected an error for malformed hash %q", encodedHash)
		}
	}
}

func TestVerifyPasswordInvalidBase64(t *testing.T) {
	t.Run("bad salt", func(t *testing.T) {
		_, err := VerifyPassword("anything", "$argon2id$v=19$m=65536,t=3,p=2$not-valid-base64!!!$aGFzaA")
		if err == nil {
			t.Error("expected an error for a non-base64 salt")
		}
	})
	t.Run("bad hash", func(t *testing.T) {
		_, err := VerifyPassword("anything", "$argon2id$v=19$m=65536,t=3,p=2$c2FsdA$not-valid-base64!!!")
		if err == nil {
			t.Error("expected an error for a non-base64 hash")
		}
	})
}
