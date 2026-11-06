// Package creditledger reads a user's credit ledger (ADR-063 Decision 1-5):
// one read, newest first with a cursor, filtered by direction, shared by the
// admin's timeline and the user's own credit history. The two differ only in
// which fields each row shows.
package creditledger

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"
)

// Transaction is one credit ledger row.
type Transaction struct {
	ID string
	// Seq is the row's insertion order; it breaks ties between rows written
	// in the same millisecond.
	Seq          int64
	UserID       string
	Type         string
	Amount       int64
	BalanceAfter int64
	// TotalBalanceAfter is the three-pool spendable total after the row
	// (ADR-063 Decision 7); nil on rows written before it existed.
	TotalBalanceAfter *int64
	Feature           string
	Note              string
	CreatedAt         time.Time
}

// Cursor marks a position in a user's ledger, newest first: the next page
// holds the rows older than it.
type Cursor struct {
	CreatedAt time.Time
	Seq       int64
}

// Direction filters the ledger by the sign of a row's amount (ADR-063
// Decision 2). A zero-amount row is in neither direction.
type Direction string

const (
	DirectionAll Direction = ""    // every row
	DirectionIn  Direction = "in"  // amount > 0
	DirectionOut Direction = "out" // amount < 0
)

// Query is a page of one user's ledger as the store reads it.
type Query struct {
	// Before, when set, keeps only the rows older than it.
	Before    *Cursor
	Direction Direction
	Limit     int
}

// Store is what the reader reads.
type Store interface {
	// Transactions returns up to q.Limit of the user's ledger rows in
	// q.Direction, newest first, older than q.Before when it is set.
	Transactions(ctx context.Context, userID string, q Query) ([]Transaction, error)
}

// Source says where a ledger row came from, for the admin's timeline.
type Source string

const (
	SourceStripe   Source = "stripe"   // a top-up or subscription payment
	SourceAdmin    Source = "admin"    // an admin grant or deduction
	SourceRefund   Source = "refund"   // a clawback after a Stripe refund
	SourceTrial    Source = "trial"    // the sign-up trial, granted or expired
	SourceReferral Source = "referral" // invite credits (ADR-051)
	SourceAI       Source = "ai"       // AI usage, or its refund after a failed call
	SourceOther    Source = "other"
)

// sourceOf maps a row to its source. An EXPIRE is the trial's unless its
// feature says it forfeited a subscription period's leftover (ADR-063).
func sourceOf(txnType, feature string) Source {
	switch txnType {
	case "GRANT_TOPUP", "GRANT_SUBSCRIPTION":
		return SourceStripe
	case "GRANT_ADMIN", "DEDUCT_ADMIN":
		return SourceAdmin
	case "CLAWBACK":
		return SourceRefund
	case "EXPIRE":
		if feature == "subscription" {
			return SourceStripe
		}
		return SourceTrial
	case "GRANT_TRIAL":
		return SourceTrial
	case "GRANT_REFERRAL_BONUS", "GRANT_REFERRAL_REWARD":
		return SourceReferral
	case "CONSUME", "SETTLE", "REFUND":
		return SourceAI
	default:
		return SourceOther
	}
}

// Page sizes of a ledger page.
const (
	DefaultLimit = 50
	MaxLimit     = 200
)

// ErrInvalidCursor is returned for a before cursor this package did not
// hand out.
var ErrInvalidCursor = errors.New("creditledger: malformed cursor")

// ErrInvalidDirection is returned for a direction other than "", "in" or
// "out".
var ErrInvalidDirection = errors.New("creditledger: unknown direction")

// Entry is one ledger row with its source.
type Entry struct {
	Transaction
	Source Source
}

// Page is one page of a user's ledger. Next, when not "", is the before
// cursor of the following page.
type Page struct {
	Entries []Entry
	Next    string
}

// Reader reads users' ledgers.
type Reader struct {
	store Store
}

func NewReader(store Store) *Reader { return &Reader{store: store} }

// ValidateDirection rejects filters other than all, in, or out.
func ValidateDirection(direction string) error {
	switch Direction(direction) {
	case DirectionAll, DirectionIn, DirectionOut:
		return nil
	default:
		return ErrInvalidDirection
	}
}

// Page returns a page of userID's ledger, newest first. before is "" for the
// first page, then the previous page's Next. direction is "", "in" or "out".
func (r *Reader) Page(ctx context.Context, userID, before, direction string, limit int) (Page, error) {
	if err := ValidateDirection(direction); err != nil {
		return Page{}, err
	}
	q := Query{Direction: Direction(direction), Limit: DefaultLimit}
	if before != "" {
		c, err := parseCursor(before)
		if err != nil {
			return Page{}, err
		}
		q.Before = &c
	}
	if limit > 0 {
		q.Limit = min(limit, MaxLimit)
	}

	rows, err := r.store.Transactions(ctx, userID, q)
	if err != nil {
		return Page{}, err
	}
	page := Page{Entries: make([]Entry, len(rows))}
	for i, t := range rows {
		page.Entries[i] = Entry{Transaction: t, Source: sourceOf(t.Type, t.Feature)}
	}
	if len(rows) == q.Limit {
		last := rows[len(rows)-1]
		page.Next = formatCursor(Cursor{CreatedAt: last.CreatedAt, Seq: last.Seq})
	}
	return page, nil
}

// A cursor travels as "<unix ms>_<seq>".
func formatCursor(c Cursor) string {
	return strconv.FormatInt(c.CreatedAt.UnixMilli(), 10) + "_" + strconv.FormatInt(c.Seq, 10)
}

func parseCursor(s string) (Cursor, error) {
	ms, seq, ok := strings.Cut(s, "_")
	if !ok {
		return Cursor{}, ErrInvalidCursor
	}
	n, err := strconv.ParseInt(ms, 10, 64)
	if err != nil {
		return Cursor{}, ErrInvalidCursor
	}
	q, err := strconv.ParseInt(seq, 10, 64)
	if err != nil {
		return Cursor{}, ErrInvalidCursor
	}
	return Cursor{CreatedAt: time.UnixMilli(n), Seq: q}, nil
}

// UserTransaction is a ledger row as its own user sees it (ADR-063
// Decision 5): no Stripe ids, no per-pool balance, no source, and a note
// only where an admin wrote it for the user to read.
type UserTransaction struct {
	CreatedAt         time.Time
	Type              string
	Feature           string
	Amount            int64
	TotalBalanceAfter *int64
	Note              string
}

// ForUser is t as its user sees it.
func ForUser(t Transaction) UserTransaction {
	u := UserTransaction{
		CreatedAt:         t.CreatedAt,
		Type:              t.Type,
		Feature:           t.Feature,
		Amount:            t.Amount,
		TotalBalanceAfter: t.TotalBalanceAfter,
	}
	if t.Type == "GRANT_ADMIN" || t.Type == "DEDUCT_ADMIN" {
		u.Note = t.Note
	}
	return u
}
