// Package feedback is user feedback (ADR-076): every record a user hands the
// maintainers -- a text note, a page report, an article choice, a definition
// report -- is one kind of a single record, stored in one table and listed on
// one admin page.
//
// It is one of the few places the server holds a page URL, which ADR-028
// otherwise promises it never collects passively, so it is fenced in:
//
//  1. Sent by the user. The extension writes nothing here on its own; for a
//     page report the user sees the cleaned URL and confirms first.
//  2. Cleaned on both ends. The server re-cleans every URL (SanitizeURL) and
//     never trusts the client's copy.
//  3. Linked to the account, so it is capped per user per day and goes when
//     the account goes (ADR-062). Nothing expires on its own.
//
// Nothing here feeds daily_stats or any per-user history feature.
package feedback

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"enx-api/utils/logger"
)

// Kind is what a feedback record is about (ADR-076 Decision 1).
type Kind string

const (
	KindText          Kind = "text"
	KindPageReport    Kind = "page_report"
	KindArticleChoice Kind = "article_choice"
	KindDefinition    Kind = "definition"
)

func (k Kind) known() bool {
	switch k {
	case KindText, KindPageReport, KindArticleChoice, KindDefinition:
		return true
	}
	return false
}

// notifies reports whether a new record of this kind is emailed to the
// admin: the kinds a user sends on purpose, not the article choices that
// arrive with every confirmed selection (ADR-076 Decision 7).
func (k Kind) notifies() bool {
	return k == KindText || k == KindPageReport || k == KindDefinition
}

// Status is where a record is in the admin's queue (ADR-076 Decision 7).
type Status string

const (
	StatusNew      Status = "new"
	StatusResolved Status = "resolved"
)

// Record is one stored feedback record. Context is the scene it was sent
// from, Details the kind's own fields; both are JSON objects.
type Record struct {
	ID        string
	UserID    string
	Kind      Kind
	URL       string
	Host      string
	Text      string
	Context   json.RawMessage
	Details   json.RawMessage
	Status    Status
	CreatedAt time.Time
}

// PageReport is a page report's own fields, gathered from its context and
// details.
type PageReport struct {
	Reason     string
	Adapter    string
	ExtVersion string
}

type pageReportContext struct {
	Adapter    string `json:"adapter"`
	ExtVersion string `json:"extVersion"`
}

type pageReportDetails struct {
	Reason string `json:"reason"`
}

// PageReport returns the page report fields of a page_report record.
func (r Record) PageReport() (PageReport, bool) {
	if r.Kind != KindPageReport {
		return PageReport{}, false
	}
	var ctx pageReportContext
	var details pageReportDetails
	if json.Unmarshal(r.Context, &ctx) != nil || json.Unmarshal(r.Details, &details) != nil {
		return PageReport{}, false
	}
	return PageReport{Reason: details.Reason, Adapter: ctx.Adapter, ExtVersion: ctx.ExtVersion}, true
}

// Submission is one record as the client sends it. Text is nil when the
// client left it out.
type Submission struct {
	Kind    Kind
	URL     string
	Text    *string
	Context json.RawMessage
	Details json.RawMessage
}

var (
	// ErrInvalid wraps every reason a submission or an admin query is refused.
	ErrInvalid = errors.New("invalid feedback")
	// ErrDailyLimit is returned once a user has used up today's records.
	ErrDailyLimit = errors.New("daily feedback limit reached")
	// ErrNotFound is returned for an id no record has.
	ErrNotFound = errors.New("feedback not found")
)

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

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
)

// dedupeWindow: the same page reported for the same reason again within
// this window is answered as done and stored once (ADR-010 Decision 9).
const dedupeWindow = 24 * time.Hour

// Admission is one write transaction in which a submission is checked and
// stored, so concurrent submissions cannot both pass the checks.
type Admission interface {
	// HasPageReportSince reports whether userID reported url for reason after since.
	HasPageReportSince(userID, url, reason string, since time.Time) (bool, error)
	// HasArticleChoice reports whether userID already sent selector for host.
	HasArticleChoice(userID, host, selector string) (bool, error)
	// CountCreated counts userID's records created in [from, to).
	CountCreated(userID string, from, to time.Time) (int64, error)
	Insert(r Record) error
}

// ListQuery selects records for the admin list. Empty Kind or Status
// matches every kind or status.
type ListQuery struct {
	Kind   Kind
	Status Status
	Limit  int
	Offset int
}

// Store keeps feedback records.
type Store interface {
	// Admit runs fn in one write transaction, committing when fn returns nil.
	Admit(ctx context.Context, fn func(Admission) error) error
	// List returns matching records, newest first (ties by id, descending).
	List(ctx context.Context, q ListQuery) ([]Record, error)
	// SetStatus sets a record's status, reporting whether the id exists.
	SetStatus(ctx context.Context, id string, status Status) (bool, error)
	// ArticleChoiceGroups groups the article choices matching q.Status by
	// host + selector: most records first, then by host and selector.
	ArticleChoiceGroups(ctx context.Context, q GroupQuery) ([]ArticleChoiceGroup, error)
	// SetArticleChoiceGroupStatus sets the status of every record in the
	// host + selector group, returning how many records it holds.
	SetArticleChoiceGroupStatus(ctx context.Context, host, selector string, status Status) (int64, error)
}

// Notifier tells the admin about a newly recorded record (ADR-010 Decision 12).
type Notifier interface {
	NotifyNewFeedback(r Record) error
}

// Service is the feedback rules: what a valid submission is, the per-user
// daily limit, deduplication and the admin's queue.
type Service struct {
	store      Store
	notifier   Notifier
	dailyLimit int
	now        func() time.Time
}

func NewService(store Store, notifier Notifier, dailyLimit int, now func() time.Time) *Service {
	return &Service{store: store, notifier: notifier, dailyLimit: dailyLimit, now: now}
}

// Submit validates and stores one record for userID. recorded is false when
// it repeats a page report or an article choice already stored, which is a
// normal outcome, not an error; text records are never deduplicated.
// A repeat is answered before the daily limit is checked, so it never
// counts against it.
func (s *Service) Submit(ctx context.Context, userID string, sub Submission) (recorded bool, err error) {
	if userID == "" {
		return false, errors.New("feedback: missing user id")
	}
	if !sub.Kind.known() {
		return false, invalid("unknown kind %q", sub.Kind)
	}
	// Each kind is accepted once its submitter and validation exist (ADR-076).
	var rec Record
	switch sub.Kind {
	case KindPageReport:
		rec, err = pageReportRecord(sub)
	case KindText:
		rec, err = textRecord(sub)
	case KindArticleChoice:
		rec, err = articleChoiceRecord(sub)
	default:
		return false, invalid("kind %q is not accepted yet", sub.Kind)
	}
	if err != nil {
		return false, err
	}

	now := s.now()
	rec.ID, rec.UserID, rec.Kind, rec.Status, rec.CreatedAt = uuid.NewString(), userID, sub.Kind, StatusNew, now
	dayStart := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)

	err = s.store.Admit(ctx, func(a Admission) error {
		if report, ok := rec.PageReport(); ok {
			dup, err := a.HasPageReportSince(userID, rec.URL, report.Reason, now.Add(-dedupeWindow))
			if err != nil || dup {
				return err
			}
		}
		if choice, ok := rec.ArticleChoice(); ok {
			dup, err := a.HasArticleChoice(userID, rec.Host, choice.Selector)
			if err != nil || dup {
				return err
			}
		}
		n, err := a.CountCreated(userID, dayStart, dayStart.AddDate(0, 0, 1))
		if err != nil {
			return err
		}
		if n >= int64(s.dailyLimit) {
			return ErrDailyLimit
		}
		if err := a.Insert(rec); err != nil {
			return err
		}
		recorded = true
		return nil
	})
	if err != nil {
		return false, err
	}

	if recorded && rec.Kind.notifies() {
		if err := s.notifier.NotifyNewFeedback(rec); err != nil {
			logger.Errorf("feedback: admin notify failed: %v", err)
		}
	}
	return recorded, nil
}

// pageReportRecord validates a page report into the fields of its record.
func pageReportRecord(sub Submission) (Record, error) {
	if sub.Text != nil {
		return Record{}, invalid("a page report has no text")
	}
	var details pageReportDetails
	if err := decodeObject(sub.Details, &details); err != nil || !reportableReasons[details.Reason] {
		return Record{}, invalid("unknown reason")
	}
	var scene pageReportContext
	if err := decodeObject(sub.Context, &scene); err != nil ||
		!adapterPattern.MatchString(scene.Adapter) || !versionPattern.MatchString(scene.ExtVersion) {
		return Record{}, invalid("malformed context")
	}
	pageURL, host, err := SanitizeURL(sub.URL)
	if err != nil {
		return Record{}, invalid("%v", err)
	}
	contextJSON, _ := json.Marshal(scene)
	detailsJSON, _ := json.Marshal(details)
	return Record{URL: pageURL, Host: host, Context: contextJSON, Details: detailsJSON}, nil
}

// MaxTextLength is the most Unicode code points a text record may hold,
// counted after trimming.
const MaxTextLength = 2000

// textContext is the scene a text record is sent from: both clients send the
// app version and browser, the extension adds the learning-mode fields.
type textContext struct {
	AppVersion    string `json:"appVersion"`
	Browser       string `json:"browser"`
	LearningMode  *bool  `json:"learningMode,omitempty"`
	Adapter       string `json:"adapter,omitempty"`
	ArticleSource string `json:"articleSource,omitempty"`
}

// browserPattern is a browser's name and major version, e.g. "Chrome 142",
// never a raw user-agent.
var browserPattern = regexp.MustCompile(`^([A-Za-z]+( [A-Za-z]+)? [0-9]{1,4})?$`)

// textRecord validates written feedback into the fields of its record. The
// page URL is optional: a user may write from a page that has none.
func textRecord(sub Submission) (Record, error) {
	if sub.Text == nil || strings.TrimSpace(*sub.Text) == "" {
		return Record{}, invalid("write some feedback before sending")
	}
	text := strings.TrimSpace(*sub.Text)
	if utf8.RuneCountInString(text) > MaxTextLength {
		return Record{}, invalid("feedback is limited to %d characters", MaxTextLength)
	}
	var scene textContext
	if err := decodeObject(sub.Context, &scene); err != nil ||
		!versionPattern.MatchString(scene.AppVersion) || !browserPattern.MatchString(scene.Browser) ||
		!adapterPattern.MatchString(scene.Adapter) ||
		(scene.ArticleSource != "" && scene.ArticleSource != "auto" && scene.ArticleSource != "user") {
		return Record{}, invalid("malformed context")
	}
	rec := Record{Text: text, Details: json.RawMessage(`{}`)}
	if sub.URL != "" {
		pageURL, host, err := SanitizeURL(sub.URL)
		if err != nil {
			return Record{}, invalid("the page URL must be a web address starting with http:// or https://")
		}
		rec.URL, rec.Host = pageURL, host
	}
	rec.Context, _ = json.Marshal(scene)
	return rec, nil
}

// decodeObject decodes a JSON object; a missing one decodes as empty.
func decodeObject(raw json.RawMessage, v any) error {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	return json.Unmarshal(raw, v)
}

const (
	// DefaultListLimit is the admin list's page size when none is asked for.
	DefaultListLimit = 100
	// MaxListLimit caps the admin list's page size.
	MaxListLimit = 200
)

// ListPage is one page of the admin list. NextOffset is nil on the last page.
type ListPage struct {
	Records    []Record
	NextOffset *int
}

// List returns one page of records for the admin, newest first, filtered
// before paging.
func (s *Service) List(ctx context.Context, q ListQuery) (ListPage, error) {
	if q.Kind != "" && !q.Kind.known() {
		return ListPage{}, invalid("unknown kind %q", q.Kind)
	}
	if err := checkPaging(q.Status, q.Limit, q.Offset); err != nil {
		return ListPage{}, err
	}

	probe := q
	probe.Limit = q.Limit + 1
	recs, err := s.store.List(ctx, probe)
	if err != nil {
		return ListPage{}, err
	}
	page := ListPage{Records: recs}
	if len(recs) > q.Limit {
		page.Records = recs[:q.Limit]
		next := q.Offset + q.Limit
		page.NextOffset = &next
	}
	return page, nil
}

// checkPaging validates an admin query's status filter and page.
func checkPaging(status Status, limit, offset int) error {
	if status != "" && status != StatusNew && status != StatusResolved {
		return invalid("unknown status %q", status)
	}
	if limit < 1 || limit > MaxListLimit {
		return invalid("limit must be 1-%d", MaxListLimit)
	}
	if offset < 0 {
		return invalid("offset must not be negative")
	}
	return nil
}

// Resolve marks a record resolved; resolving it again is a no-op. The
// record is kept.
func (s *Service) Resolve(ctx context.Context, id string) error {
	found, err := s.store.SetStatus(ctx, id, StatusResolved)
	if err != nil {
		return err
	}
	if !found {
		return ErrNotFound
	}
	return nil
}
