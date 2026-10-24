// Package conflict holds the administrator-investigation rules for
// subscription conflicts (ADR-067 §管理员处理与邮件): recording an
// administrator's resolution, a user's billing-support request, and the
// admin list query. It is pure: the caller reads the subscription row, applies
// the result under a conditional write, and raises the alert the result asks
// for in the same transaction.
//
// Resolution records that an administrator investigated, not that billing
// stopped or a refund was made. Nothing here reopens, promotes, cancels or
// refunds a conflict.
package conflict

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

// Status is a conflict's investigation state, kept on its subscription row.
type Status string

const (
	Open     Status = "open"
	Resolved Status = "resolved"
)

var (
	// ErrInvalidStatus: the request names a status other than resolved
	// (resolution) or other than open/resolved (list filter). Answer 400.
	ErrInvalidStatus = errors.New("billing/conflict: invalid conflict status")
	// ErrBlankNotes: a resolution needs nonblank notes. Answer 400.
	ErrBlankNotes = errors.New("billing/conflict: resolution notes are blank")
	// ErrResolutionDiffers: the conflict is already resolved with other
	// notes. Answer 409; the first resolution stands.
	ErrResolutionDiffers = errors.New("billing/conflict: already resolved differently")

	// ErrNotOwnedConflict: the subscription is not a conflict owned by the
	// requesting user. Answer 404 so another user's subscription stays
	// unconfirmed.
	ErrNotOwnedConflict = errors.New("billing/conflict: not a subscription conflict of this user")
	// ErrBlankMessage and ErrMessageTooLong: a support message must be
	// nonblank and at most MaxSupportMessageLength characters. Answer 400.
	ErrBlankMessage   = errors.New("billing/conflict: support message is blank")
	ErrMessageTooLong = errors.New("billing/conflict: support message is too long")
)

// Resolution is a conflict's investigation state and, once resolved, who
// resolved it, when, and their notes.
type Resolution struct {
	Status     Status
	ResolverID string
	ResolvedAt time.Time
	Notes      string
}

// ResolveRequest is the body of PATCH /api/admin/subscription-conflicts/:id.
type ResolveRequest struct {
	Status string
	Notes  string
}

// Resolve applies an administrator's resolution, by local user operatorID at
// now. It returns the resolution to store and whether it changed. Repeating
// the identical resolution changes nothing and keeps the first operator and
// time; different notes on a resolved conflict are ErrResolutionDiffers.
func Resolve(current Resolution, req ResolveRequest, operatorID string, now time.Time) (Resolution, bool, error) {
	if Status(req.Status) != Resolved {
		return current, false, ErrInvalidStatus
	}
	notes := strings.TrimSpace(req.Notes)
	if notes == "" {
		return current, false, ErrBlankNotes
	}
	if current.Status == Resolved {
		if current.Notes != notes {
			return current, false, ErrResolutionDiffers
		}
		return current, false, nil
	}
	return Resolution{Status: Resolved, ResolverID: operatorID, ResolvedAt: now, Notes: notes}, true, nil
}

// MaxSupportMessageLength is the support message limit in characters.
const MaxSupportMessageLength = 2000

// Support is the first billing-support request on a conflict; zero when the
// user has sent none.
type Support struct {
	Message string
	At      time.Time
}

// Subscription is what RequestSupport needs of a subscription row: its owner
// (empty until trusted attribution), whether ENX classified it as a conflict
// (open or resolved), and any support request already recorded.
type Subscription struct {
	OwnerID  string
	Conflict bool
	Support  Support
}

// RequestSupport records a user's billing-support message on their own
// conflict. created is true only for the first request: the caller stores it
// and raises its support alert in the same transaction. A repeated request
// returns the first one and raises nothing.
func RequestSupport(sub Subscription, requesterID, message string, now time.Time) (Support, bool, error) {
	if !sub.Conflict || sub.OwnerID == "" || sub.OwnerID != requesterID {
		return Support{}, false, ErrNotOwnedConflict
	}
	message = strings.TrimSpace(message)
	if message == "" {
		return Support{}, false, ErrBlankMessage
	}
	if utf8.RuneCountInString(message) > MaxSupportMessageLength {
		return Support{}, false, ErrMessageTooLong
	}
	if !sub.Support.At.IsZero() {
		return sub.Support, false, nil
	}
	return Support{Message: message, At: now}, true, nil
}

const (
	DefaultListLimit = 50
	MaxListLimit     = 200
)

// ListQuery is one page of GET /api/admin/subscription-conflicts, newest
// discovery first. Status "" lists open and resolved conflicts.
type ListQuery struct {
	Status Status
	Limit  int
	Offset int
}

// ParseListQuery validates the status filter and bounds the page.
func ParseListQuery(status string, limit, offset int) (ListQuery, error) {
	switch Status(status) {
	case "", Open, Resolved:
	default:
		return ListQuery{}, ErrInvalidStatus
	}
	if limit <= 0 {
		limit = DefaultListLimit
	}
	return ListQuery{Status: Status(status), Limit: min(limit, MaxListLimit), Offset: max(offset, 0)}, nil
}
