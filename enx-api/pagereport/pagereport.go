// Package pagereport stores pages the user explicitly reported as ones
// Catglish could not process (docs/architecture/adr-010-x-tweet-page-support.md
// Decision 8).
//
// This is the one place the server holds a page URL, and it is deliberately
// fenced in, because ADR-028 promises the opposite for reading statistics
// ("we record how much you read, not what you read"):
//
//  1. Opt-in per report. The extension writes nothing here on its own; the
//     user sees the sanitized URL and confirms before anything is sent.
//  2. Sanitized on both ends. The extension shows the user what will be sent;
//     the server re-sanitizes and never trusts the client's version.
//  3. Short-lived and capped: rows expire after `retention` and each user
//     keeps at most MaxReportsPerUser.
//
// Nothing here feeds daily_stats or any per-user history feature.
package pagereport

import (
	"context"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"enx-api/utils/sqlitex"
)

const (
	// retention is how long a report is kept: long enough to get to it,
	// short enough that this is not a browsing history.
	retention = 90 * 24 * time.Hour
	// dedupeWindow: reporting the same page for the same reason again within
	// this window is a no-op (a user double-clicking, or retrying).
	dedupeWindow = 24 * time.Hour
	// MaxReportsPerUser caps stored reports per user; the oldest is evicted.
	MaxReportsPerUser = 50

	maxRawURLLength       = 4096
	maxSanitizedURLLength = 1024
	redacted              = ":redacted"
)

var (
	// ErrInvalidURL is returned for a URL that is not a usable http(s) page.
	ErrInvalidURL = errors.New("pagereport: invalid url")
	// ErrInvalidReason is returned for a reason the extension never reports.
	ErrInvalidReason = errors.New("pagereport: invalid reason")
	// ErrInvalidField is returned for a malformed adapter or version.
	ErrInvalidField = errors.New("pagereport: invalid field")
)

// reportableReasons mirrors enx-chrome's isReportableFailure: the failures
// that say "this page's layout defeated us". A network error or an expired
// session says nothing about the page and is never reported.
var reportableReasons = map[string]bool{
	"no-article-node": true,
	"no-words":        true,
	"error":           true,
}

var (
	adapterPattern = regexp.MustCompile(`^[a-z0-9-]{0,32}$`)
	versionPattern = regexp.MustCompile(`^[0-9A-Za-z.+-]{0,32}$`)
	uuidPattern    = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

// Input is one report as the client sends it.
type Input struct {
	URL        string
	Reason     string
	Adapter    string
	ExtVersion string
}

// opaqueSegment reports whether a path segment looks like an identifier that
// could identify a person or grant access -- an email, a UUID, or a long
// separator-free token (some newsletter and unsubscribe links carry these in
// the path). A 19-digit tweet id has no letters and a hyphenated slug has
// separators, so neither is caught.
func opaqueSegment(seg string) bool {
	if strings.Contains(seg, "@") || uuidPattern.MatchString(seg) {
		return true
	}
	if strings.ContainsAny(seg, "-_.") {
		return false
	}
	if len(seg) >= 32 {
		return true
	}
	if len(seg) < 20 {
		return false
	}
	hasLetter, hasDigit := false, false
	for _, r := range seg {
		hasLetter = hasLetter || unicode.IsLetter(r)
		hasDigit = hasDigit || unicode.IsDigit(r)
	}
	return hasLetter && hasDigit
}

// SanitizeURL reduces raw to origin + path: the query string, fragment and
// any credentials are dropped, the host is lowercased, and opaque path
// segments are replaced with ":redacted". It returns the sanitized URL and
// its host. The extension has a matching implementation so the user sees
// exactly what will be sent; this one is authoritative.
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

	clean := url.URL{Scheme: u.Scheme, Host: strings.ToLower(u.Host), Path: path}
	out := clean.String()
	if len(out) > maxSanitizedURLLength {
		return "", "", ErrInvalidURL
	}
	return out, strings.ToLower(u.Hostname()), nil
}

// Submit validates and stores one report for userID. recorded is false when
// the same page was already reported for the same reason within
// dedupeWindow, which is a normal outcome, not an error.
func Submit(ctx context.Context, userID string, in Input, now time.Time) (recorded bool, err error) {
	if userID == "" {
		return false, errors.New("pagereport: missing user id")
	}
	if !reportableReasons[in.Reason] {
		return false, ErrInvalidReason
	}
	if !adapterPattern.MatchString(in.Adapter) || !versionPattern.MatchString(in.ExtVersion) {
		return false, ErrInvalidField
	}
	pageURL, host, err := SanitizeURL(in.URL)
	if err != nil {
		return false, err
	}

	err = sqlitex.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var dupes int64
		if err := tx.Model(&sqlitex.PageReport{}).
			Where("user_id = ? AND url = ? AND reason = ? AND created_at > ?",
				userID, pageURL, in.Reason, now.Add(-dedupeWindow).UnixMilli()).
			Count(&dupes).Error; err != nil {
			return err
		}
		if dupes > 0 {
			return nil
		}

		if err := tx.Create(&sqlitex.PageReport{
			ID:         uuid.NewString(),
			UserID:     userID,
			URL:        pageURL,
			Host:       host,
			Reason:     in.Reason,
			Adapter:    in.Adapter,
			ExtVersion: in.ExtVersion,
			CreatedAt:  now.UnixMilli(),
		}).Error; err != nil {
			return err
		}
		recorded = true

		// Evict the oldest rows beyond the per-user cap.
		return tx.Exec(
			`DELETE FROM page_reports WHERE user_id = ? AND id NOT IN (
				SELECT id FROM page_reports WHERE user_id = ?
				ORDER BY created_at DESC, id DESC LIMIT ?)`,
			userID, userID, MaxReportsPerUser).Error
	})
	if err != nil {
		return false, err
	}
	return recorded, nil
}

// PurgeExpired hard-deletes reports older than the retention period.
func PurgeExpired(ctx context.Context, now time.Time) (int64, error) {
	res := sqlitex.DB.WithContext(ctx).
		Where("created_at < ?", now.Add(-retention).UnixMilli()).
		Delete(&sqlitex.PageReport{})
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}
