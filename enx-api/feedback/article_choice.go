package feedback

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"unicode"
	"unicode/utf8"
)

// ArticleChoice is an article choice's own fields (ADR-073 Decision 5): the
// selector the user's confirmed choice generated, and what automatic
// detection found on the page at that moment. AutoSelector and AutoPlatform
// are empty when detection had none.
type ArticleChoice struct {
	Selector     string
	AutoSource   string
	AutoSelector string
	AutoPlatform string
}

type articleChoiceDetails struct {
	Selector     string  `json:"selector"`
	AutoSource   string  `json:"autoSource"`
	AutoSelector *string `json:"autoSelector,omitempty"`
	AutoPlatform *string `json:"autoPlatform,omitempty"`
}

// ArticleChoice returns the article choice fields of an article_choice record.
func (r Record) ArticleChoice() (ArticleChoice, bool) {
	if r.Kind != KindArticleChoice {
		return ArticleChoice{}, false
	}
	var d articleChoiceDetails
	if json.Unmarshal(r.Details, &d) != nil {
		return ArticleChoice{}, false
	}
	choice := ArticleChoice{Selector: d.Selector, AutoSource: d.AutoSource}
	if d.AutoSelector != nil {
		choice.AutoSelector = *d.AutoSelector
	}
	if d.AutoPlatform != nil {
		choice.AutoPlatform = *d.AutoPlatform
	}
	return choice, true
}

// MaxSelectorLength is the most Unicode code points a selector may hold.
const MaxSelectorLength = 2048

// validSelector accepts a nonempty selector of printable characters and CSS
// whitespace. It is never trimmed: its exact bytes group the records.
func validSelector(s string) bool {
	if s == "" || !utf8.ValidString(s) || utf8.RuneCountInString(s) > MaxSelectorLength {
		return false
	}
	for _, r := range s {
		if !unicode.IsGraphic(r) && !strings.ContainsRune(" \t\n\r\f", r) {
			return false
		}
	}
	return true
}

// articleChoiceRecord validates an article choice into the fields of its
// record. It carries no page text or title, only the page's cleaned URL.
func articleChoiceRecord(sub Submission) (Record, error) {
	if sub.Text != nil {
		return Record{}, invalid("an article choice has no text")
	}
	var d articleChoiceDetails
	if err := decodeObject(sub.Details, &d); err != nil || !validSelector(d.Selector) {
		return Record{}, invalid("malformed selector")
	}
	switch d.AutoSource {
	case "article":
		if d.AutoSelector != nil && !validSelector(*d.AutoSelector) {
			return Record{}, invalid("malformed autoSelector")
		}
		if d.AutoPlatform != nil &&
			(d.AutoSelector == nil || *d.AutoPlatform == "" || !adapterPattern.MatchString(*d.AutoPlatform)) {
			return Record{}, invalid("malformed autoPlatform")
		}
	case "whole-page", "none":
		if d.AutoSelector != nil || d.AutoPlatform != nil {
			return Record{}, invalid("autoSource %q has no autoSelector or autoPlatform", d.AutoSource)
		}
	default:
		return Record{}, invalid("unknown autoSource")
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
	return Record{URL: pageURL, Host: host, Context: contextJSON, Details: marshalVerbatim(d)}, nil
}

// marshalVerbatim encodes v without HTML escaping, so a selector's ">" and
// "&" are stored as sent.
func marshalVerbatim(v any) json.RawMessage {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
	return bytes.TrimSuffix(b.Bytes(), []byte("\n"))
}

// GroupQuery selects article choice groups for the admin. Status filters
// the records before they are grouped; empty matches every status.
type GroupQuery struct {
	Status Status
	Limit  int
	Offset int
}

// ArticleChoiceGroup is the article choices for one host + selector, a rule
// candidate for #710. Count is the records matching the query's status, one
// per user since each user's choice is stored once; Total is every record
// in the group whatever its status. SampleURL is the newest matching record's.
type ArticleChoiceGroup struct {
	Host      string
	Selector  string
	Count     int64
	Total     int64
	SampleURL string
}

// GroupPage is one page of article choice groups. NextOffset is nil on the
// last page.
type GroupPage struct {
	Groups     []ArticleChoiceGroup
	NextOffset *int
}

// ListArticleChoiceGroups returns one page of article choice groups, grouped
// on the server so a group's count spans every record, not one page of them.
func (s *Service) ListArticleChoiceGroups(ctx context.Context, q GroupQuery) (GroupPage, error) {
	if err := checkPaging(q.Status, q.Limit, q.Offset); err != nil {
		return GroupPage{}, err
	}
	probe := q
	probe.Limit = q.Limit + 1
	groups, err := s.store.ArticleChoiceGroups(ctx, probe)
	if err != nil {
		return GroupPage{}, err
	}
	page := GroupPage{Groups: groups}
	if len(groups) > q.Limit {
		page.Groups = groups[:q.Limit]
		next := q.Offset + q.Limit
		page.NextOffset = &next
	}
	return page, nil
}

// ResolveArticleChoiceGroup marks every record in the host + selector group
// resolved, whatever its status, and returns how many there are. Each
// record keeps its own row and stays listed.
func (s *Service) ResolveArticleChoiceGroup(ctx context.Context, host, selector string) (int64, error) {
	if host == "" || selector == "" {
		return 0, invalid("host and selector are required")
	}
	n, err := s.store.SetArticleChoiceGroupStatus(ctx, host, selector, StatusResolved)
	if err != nil {
		return 0, err
	}
	if n == 0 {
		return 0, ErrNotFound
	}
	return n, nil
}
