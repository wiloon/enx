package feedback

import (
	"errors"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	maxRawURLLength       = 4096
	maxSanitizedURLLength = 1024
	redacted              = ":redacted"
)

// ErrInvalidURL is returned for a URL that is not a usable http(s) page.
var ErrInvalidURL = errors.New("invalid url")

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// opaqueSegment reports whether a path segment looks like an identifier that
// could identify a person or grant access -- an email, a UUID, or a long
// separator-free token (some newsletter and unsubscribe links carry these in
// the path). A 19-digit tweet id has no letters and a hyphenated slug has
// separators, so neither is caught. Lengths count code points, not bytes, so a
// short CJK word is not mistaken for a token (ADR-076 Decision 3).
func opaqueSegment(seg string) bool {
	if strings.Contains(seg, "@") || uuidPattern.MatchString(seg) {
		return true
	}
	if strings.ContainsAny(seg, "-_.") {
		return false
	}
	length := utf8.RuneCountInString(seg)
	if length >= 32 {
		return true
	}
	if length < 20 {
		return false
	}
	hasLetter, hasDigit := false, false
	for _, r := range seg {
		hasLetter = hasLetter || unicode.IsLetter(r)
		hasDigit = hasDigit || unicode.IsDigit(r)
	}
	return hasLetter && hasDigit
}

// SanitizeURL reduces raw to origin + path (ADR-010 Decision 8, ADR-076
// Decision 3): the query string, fragment and any credentials are dropped, a
// default port (:443 for https, :80 for http) goes with them, the host is
// lowercased, and opaque path segments are replaced with ":redacted". It
// returns the sanitized URL and its host. The extension has a matching
// implementation so the user sees exactly what will be sent; this one is
// authoritative.
func SanitizeURL(raw string) (sanitized, host string, err error) {
	if raw == "" || len(raw) > maxRawURLLength {
		return "", "", ErrInvalidURL
	}
	u, perr := url.Parse(raw)
	if perr != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		return "", "", ErrInvalidURL
	}

	segments := strings.Split(u.Path, "/")
	for i, seg := range segments {
		if opaqueSegment(seg) {
			segments[i] = redacted
		}
	}
	path := strings.Join(segments, "/")
	if path == "" {
		path = "/"
	}

	sanitizedHost := strings.ToLower(u.Host)
	if (u.Scheme == "https" && u.Port() == "443") || (u.Scheme == "http" && u.Port() == "80") {
		sanitizedHost = strings.TrimSuffix(sanitizedHost, ":"+u.Port())
	}
	clean := url.URL{Scheme: u.Scheme, Host: sanitizedHost, Path: path}
	out := clean.String()
	if len(out) > maxSanitizedURLLength {
		return "", "", ErrInvalidURL
	}
	return out, strings.ToLower(u.Hostname()), nil
}
