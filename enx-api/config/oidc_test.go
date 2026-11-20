package config

import (
	"reflect"
	"strings"
	"testing"
)

const clerkIssuer = "https://enx.clerk.accounts.dev"

func TestOIDCDefaultsFollowClerk(t *testing.T) {
	isolate(t)
	t.Setenv("CLERK_ISSUER", clerkIssuer)
	t.Setenv("CLERK_AUTHORIZED_PARTIES", "https://enx.wiloon.lab chrome-extension://abc")

	cfg := loadDefaults(t)
	want := OIDC{
		Issuer:                   clerkIssuer,
		JWKSURL:                  clerkIssuer + "/.well-known/jwks.json",
		AuthorizedParties:        []string{"https://enx.wiloon.lab", "chrome-extension://abc"},
		AuthorizedPartyClaim:     "azp",
		AllowedSigningAlgorithms: []string{"RS256"},
		SubjectClaim:             "sub",
		EmailClaim:               "email",
		NameClaim:                "name",
		ImageURLClaim:            "image_url",
	}
	if !reflect.DeepEqual(cfg.OIDC, want) {
		t.Errorf("OIDC = %+v, want %+v", cfg.OIDC, want)
	}
}

func TestOIDCDefaultJWKSURLUsesClerkOverride(t *testing.T) {
	isolate(t)
	t.Setenv("CLERK_ISSUER", clerkIssuer)
	t.Setenv("CLERK_JWKS_URL", "https://jwks.test/keys")

	if got := loadDefaults(t).OIDC.JWKSURL; got != "https://jwks.test/keys" {
		t.Errorf("OIDC.JWKSURL = %q, want the Clerk override", got)
	}
}

func TestOIDCOtherIssuerNeedsItsOwnJWKSURL(t *testing.T) {
	isolate(t)
	t.Setenv("CLERK_ISSUER", clerkIssuer)
	t.Setenv("OIDC_ISSUER", "https://logto.example/oidc")

	if _, err := Load(""); err == nil || !strings.Contains(err.Error(), "oidc.jwks-url") {
		t.Fatalf("Load error = %v, want one naming oidc.jwks-url", err)
	}

	t.Setenv("OIDC_JWKS_URL", "https://logto.example/oidc/jwks")
	cfg := loadDefaults(t)
	if cfg.OIDC.Issuer != "https://logto.example/oidc" || cfg.OIDC.JWKSURL != "https://logto.example/oidc/jwks" {
		t.Errorf("OIDC issuer/jwks = %q / %q", cfg.OIDC.Issuer, cfg.OIDC.JWKSURL)
	}
}

func TestOIDCPartiesOverrideLeavesClerkListAlone(t *testing.T) {
	isolate(t)
	t.Setenv("CLERK_ISSUER", clerkIssuer)
	t.Setenv("CLERK_AUTHORIZED_PARTIES", "https://enx.wiloon.lab")
	t.Setenv("OIDC_AUTHORIZED_PARTIES", "logto-app")

	cfg := loadDefaults(t)
	if !reflect.DeepEqual(cfg.OIDC.AuthorizedParties, []string{"logto-app"}) {
		t.Errorf("OIDC.AuthorizedParties = %q", cfg.OIDC.AuthorizedParties)
	}
	if !reflect.DeepEqual(cfg.Clerk.AuthorizedParties, []string{"https://enx.wiloon.lab"}) {
		t.Errorf("Clerk.AuthorizedParties = %q", cfg.Clerk.AuthorizedParties)
	}
}

func TestOIDCPartiesOverrideInTOMLRequiresAUsableEntry(t *testing.T) {
	isolate(t)
	t.Setenv("CLERK_AUTHORIZED_PARTIES", "https://enx.wiloon.lab")
	for name, parties := range map[string]string{
		"empty list":      `[]`,
		"empty entry":     `[""]`,
		"whitespace only": `["", "   "]`,
	} {
		t.Run(name, func(t *testing.T) {
			path := writeTOML(t, "[oidc]\nauthorized-parties = "+parties+"\n")
			if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "oidc.authorized-parties") {
				t.Fatalf("Load error = %v, want one naming oidc.authorized-parties", err)
			}
		})
	}
}

func TestOIDCSigningAlgorithmsFromEnvAndTOML(t *testing.T) {
	isolate(t)
	t.Setenv("OIDC_ALLOWED_SIGNING_ALGORITHMS", "ES384 RS256")
	if got := loadDefaults(t).OIDC.AllowedSigningAlgorithms; !reflect.DeepEqual(got, []string{"ES384", "RS256"}) {
		t.Errorf("env algorithms = %q", got)
	}

	isolate(t)
	path := writeTOML(t, "[oidc]\nallowed-signing-algorithms = [\"ES384\"]\n")
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !reflect.DeepEqual(cfg.OIDC.AllowedSigningAlgorithms, []string{"ES384"}) {
		t.Errorf("toml algorithms = %q", cfg.OIDC.AllowedSigningAlgorithms)
	}
}

func TestOIDCExplicitlyEmptyAlgorithmEnvIsRejected(t *testing.T) {
	for _, value := range []string{"", "   "} {
		isolate(t)
		t.Setenv("OIDC_ALLOWED_SIGNING_ALGORITHMS", value)
		if _, err := Load(""); err == nil || !strings.Contains(err.Error(), "oidc.allowed-signing-algorithms") {
			t.Errorf("value %q: Load error = %v, want one naming oidc.allowed-signing-algorithms", value, err)
		}
	}
}

func TestValidateRejectsUnsafeSigningAlgorithms(t *testing.T) {
	for name, algs := range map[string][]string{
		"empty":   {},
		"HS256":   {"HS256"},
		"none":    {"none"},
		"unknown": {"RS999"},
		"mixed":   {"RS256", "HS512"},
	} {
		t.Run(name, func(t *testing.T) {
			cfg := Default()
			cfg.OIDC.AllowedSigningAlgorithms = algs
			if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "oidc.allowed-signing-algorithms") {
				t.Errorf("Validate() = %v, want an error naming oidc.allowed-signing-algorithms", err)
			}
		})
	}
	for _, alg := range []string{"RS256", "PS384", "ES384", "ES512"} {
		cfg := Default()
		cfg.OIDC.AllowedSigningAlgorithms = []string{alg}
		if err := cfg.Validate(); err != nil {
			t.Errorf("Validate() with %s = %v", alg, err)
		}
	}
}

func TestValidateRejectsEmptyOIDCClaimNames(t *testing.T) {
	for key, claim := range map[string]func(*OIDC) *string{
		"oidc.authorized-party-claim": func(o *OIDC) *string { return &o.AuthorizedPartyClaim },
		"oidc.subject-claim":          func(o *OIDC) *string { return &o.SubjectClaim },
		"oidc.email-claim":            func(o *OIDC) *string { return &o.EmailClaim },
		"oidc.name-claim":             func(o *OIDC) *string { return &o.NameClaim },
		"oidc.image-url-claim":        func(o *OIDC) *string { return &o.ImageURLClaim },
	} {
		t.Run(key, func(t *testing.T) {
			cfg := Default()
			*claim(&cfg.OIDC) = ""
			if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), key+" must not be empty") {
				t.Errorf("Validate() = %v, want an error naming %s", err, key)
			}
		})
	}
}
