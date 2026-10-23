package config

import (
	"strings"
	"testing"
)

const (
	prodIssuer = "https://clerk.catglish.com"
	devIssuer  = "https://rational-deer-4450.clerk.accounts.dev"
	liveKey    = "sk_live_should_never_be_logged"
	testKey    = "sk_test_should_never_be_logged"
)

func TestClerkIsProductionInstance(t *testing.T) {
	cases := []struct {
		issuer string
		want   bool
	}{
		{prodIssuer, true},
		{"https://Clerk.Example.com:443", true},
		{devIssuer, false},
		{"https://Rational-Deer-4450.CLERK.Accounts.DEV", false},
		{"https://clerk.accounts.dev", false},
		{"https://clerk.accounts.dev:8443/", false},
		{"", false},
		// A look-alike that only ends in the dev domain's text is production.
		{"https://evilclerk.accounts.dev.example.com", true},
		{"https://notclerk.accounts.dev", true},
	}
	for _, c := range cases {
		if got := (Clerk{Issuer: c.issuer}).IsProductionInstance(); got != c.want {
			t.Errorf("Clerk{Issuer: %q}.IsProductionInstance() = %v, want %v", c.issuer, got, c.want)
		}
	}
}

func validateClerk(issuer string, key Secret) error {
	cfg := Default()
	cfg.Clerk.Issuer = issuer
	cfg.Clerk.SecretKey = key
	return cfg.Validate()
}

func TestValidateRejectsAnIssuerWithNoHostname(t *testing.T) {
	for _, issuer := range []string{"clerk.example.com", "from-CLERK_ISSUER", "https://", "://bad"} {
		err := validateClerk(issuer, "")
		if err == nil {
			t.Errorf("issuer %q: Validate() = nil, want an error naming clerk.issuer", issuer)
			continue
		}
		if !strings.Contains(err.Error(), "clerk.issuer") {
			t.Errorf("issuer %q: error = %v, want it to name clerk.issuer", issuer, err)
		}
	}
}

func TestValidateRequiresTheSecretKeyForAProductionIssuer(t *testing.T) {
	err := validateClerk(prodIssuer, "")
	if err == nil {
		t.Fatal("Validate() = nil, want an error: a production issuer needs clerk.secret-key")
	}
	if !strings.Contains(err.Error(), "clerk.secret-key") {
		t.Errorf("error = %v, want it to name clerk.secret-key", err)
	}
}

func TestValidateRejectsAKeyOfTheWrongInstanceType(t *testing.T) {
	cases := []struct {
		name   string
		issuer string
		key    Secret
	}{
		{"test key with a production issuer", prodIssuer, testKey},
		{"live key with a dev issuer", devIssuer, liveKey},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateClerk(c.issuer, c.key)
			if err == nil {
				t.Fatal("Validate() = nil, want an error")
			}
			if !strings.Contains(err.Error(), "clerk.secret-key") {
				t.Errorf("error = %v, want it to name clerk.secret-key", err)
			}
			if strings.Contains(err.Error(), c.key.Reveal()) {
				t.Errorf("error leaks the key: %v", err)
			}
		})
	}
}

func TestValidateRejectsAKeyWithAnUnknownPrefix(t *testing.T) {
	keys := []Secret{
		"pk_live_should_never_be_logged",
		"rk_test_should_never_be_logged",
		" " + testKey,
		testKey + "\n",
		" " + liveKey + " ",
	}
	for _, issuer := range []string{devIssuer, prodIssuer, ""} {
		for _, key := range keys {
			err := validateClerk(issuer, key)
			if err == nil {
				t.Errorf("issuer %q, key %q: Validate() = nil, want an error", issuer, key.Reveal())
				continue
			}
			if !strings.Contains(err.Error(), "clerk.secret-key") {
				t.Errorf("issuer %q: error = %v, want it to name clerk.secret-key", issuer, err)
			}
			if strings.Contains(err.Error(), strings.TrimSpace(key.Reveal())) {
				t.Errorf("issuer %q: error leaks the key: %v", issuer, err)
			}
		}
	}
}

func TestValidateRejectsAKeyWithNothingAfterItsPrefix(t *testing.T) {
	for _, issuer := range []string{devIssuer, prodIssuer, ""} {
		for _, key := range []Secret{"sk_live_", "sk_test_"} {
			err := validateClerk(issuer, key)
			if err == nil {
				t.Errorf("issuer %q, key %q: Validate() = nil, want an error", issuer, key.Reveal())
				continue
			}
			if !strings.Contains(err.Error(), "clerk.secret-key has nothing after its prefix") {
				t.Errorf("issuer %q, key %q: error = %v, want it to say clerk.secret-key has nothing after its prefix", issuer, key.Reveal(), err)
			}
		}
	}
}

func TestValidateAcceptsMatchingClerkSettings(t *testing.T) {
	cases := []struct {
		name   string
		issuer string
		key    Secret
	}{
		{"dev issuer without a key", devIssuer, ""},
		{"dev issuer with a test key", devIssuer, testKey},
		{"production issuer with a live key", prodIssuer, liveKey},
		{"no issuer and no key", "", ""},
		{"no issuer with a test key", "", testKey},
		{"no issuer with a live key", "", liveKey},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := validateClerk(c.issuer, c.key); err != nil {
				t.Errorf("Validate() = %v, want nil", err)
			}
		})
	}
}
