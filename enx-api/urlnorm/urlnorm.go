// Package urlnorm normalizes page URLs. ForSave keeps a URL usable for
// reopening the page (ADR-032 Options C3); it is deliberately weaker than the
// redaction pagereport applies for diagnostics.
package urlnorm

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// ErrInvalidURL is returned for anything that is not an http(s) page with a host.
var ErrInvalidURL = errors.New("urlnorm: invalid url")

// MaxURLLength is the longest normalized URL that can be saved. A normal page
// address is a few hundred characters; 2048 is the length browsers and servers
// have long agreed on, so it is generous without being unbounded.
const MaxURLLength = 2048

// maxRawURLLength bounds what ForSave is willing to parse at all. It is looser
// than MaxURLLength because normalization can shrink a link a great deal.
const maxRawURLLength = 4096

// ErrURLTooLong is returned for a URL longer than MaxURLLength. It wraps
// ErrInvalidURL, so callers that only care "is this saveable" need one check.
var ErrURLTooLong = fmt.Errorf("%w: longer than %d characters", ErrInvalidURL, MaxURLLength)

// ForSave normalizes raw for saving and returns it with its host.
func ForSave(raw string) (normalized, host string, err error) {
	if len(raw) > maxRawURLLength {
		return "", "", ErrURLTooLong
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		return "", "", ErrInvalidURL
	}
	u.User = nil
	u.Fragment = ""
	u.RawFragment = ""
	u.Host = strings.ToLower(u.Host)
	u.RawQuery = dropTrackingParams(u.RawQuery, isXHost(u.Hostname()))
	normalized = u.String()
	// Measured after normalization: a short page address that arrived with a
	// long tracking suffix is still a short page address.
	if len(normalized) > MaxURLLength {
		return "", "", ErrURLTooLong
	}
	return normalized, u.Hostname(), nil
}

// isTrackingParam reports whether key is a campaign / click-id parameter that
// identifies how the user arrived, not which page it is.
func isTrackingParam(key string, onX bool) bool {
	key = strings.ToLower(key)
	if onX && (key == "s" || key == "t") {
		// X's share button appends ?s=20&t=<token>. Only on X: elsewhere
		// these are real parameters (t=90 is a video timestamp).
		return true
	}
	return strings.HasPrefix(key, "utm_") ||
		strings.HasPrefix(key, "mc_") ||
		key == "fbclid" ||
		key == "gclid"
}

var xHost = regexp.MustCompile(`(^|\.)(x|twitter)\.com$`)

func isXHost(host string) bool {
	return xHost.MatchString(host)
}

// dropTrackingParams filters the raw query rather than re-encoding it, so the
// surviving parameters keep their original order and escaping.
func dropTrackingParams(rawQuery string, onX bool) string {
	if rawQuery == "" {
		return ""
	}
	var kept []string
	for _, pair := range strings.Split(rawQuery, "&") {
		key, _, _ := strings.Cut(pair, "=")
		if pair == "" || isTrackingParam(key, onX) {
			continue
		}
		kept = append(kept, pair)
	}
	return strings.Join(kept, "&")
}
