// Package adminuser answers the admin users page (ADR-049 Decision 11-15):
// who has an account, what they hold, where their credits came from and
// went. It shows accounts, billing and usage counts only, never the pages a
// user saved or the words they looked up.
package adminuser

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"
)

// Account is one user with their subscription and credit balances, as
// stored. A user is a users row with a Clerk id (ADR-049 Decision 15).
type Account struct {
	UserID string
	Email  string
	Name   string
	// Status is users.status: "active", or "disabled" (ADR-062).
	Status             string
	CreatedAt          time.Time
	LastLoginAt        time.Time
	Plan               string
	SubscriptionStatus string
	StripeCustomerID   string

	SubscriptionBalance int64
	TopupBalance        int64
	TrialBalance        int64
	TrialExpiresAt      *time.Time
}

// LedgerSum is the total amount and number of one user's ledger rows of one
// type.
type LedgerSum struct {
	Sum   int64
	Count int64
}

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
	Feature      string
	Note         string
	CreatedAt    time.Time
}

// Cursor marks a position in a user's ledger, newest first: the next page
// holds the rows older than it.
type Cursor struct {
	CreatedAt time.Time
	Seq       int64
}

func (t Transaction) olderThan(c Cursor) bool {
	if !t.CreatedAt.Equal(c.CreatedAt) {
		return t.CreatedAt.Before(c.CreatedAt)
	}
	return t.Seq < c.Seq
}

// Sort orders the users list.
type Sort string

const (
	SortCreated   Sort = "created"    // newest account first (default)
	SortLastLogin Sort = "last_login" // most recent sign-in first
	SortBalance   Sort = "balance"    // largest stored balance first
)

// ListQuery is a page of the users list as the store reads it.
type ListQuery struct {
	// Query matches an email substring or an exact user id; "" matches
	// everyone.
	Query  string
	Sort   Sort
	Limit  int
	Offset int
}

// Store is what the service reads.
type Store interface {
	// ListAccounts returns one page of accounts and how many match in all.
	ListAccounts(ctx context.Context, q ListQuery) ([]Account, int64, error)
	// Account returns one account; false when there is none.
	Account(ctx context.Context, userID string) (Account, bool, error)
	// LedgerSums totals each user's ledger rows by type.
	LedgerSums(ctx context.Context, userIDs []string) (map[string]map[string]LedgerSum, error)
	// DailyLookups counts the user's lookups in [from, to) by UTC date.
	DailyLookups(ctx context.Context, userID string, from, to time.Time) (map[string]int64, error)
	// AISpend totals the credits the user's AI calls took in [from, to), by
	// feature, as positive numbers.
	AISpend(ctx context.Context, userID string, from, to time.Time) (map[string]int64, error)
	// Transactions returns up to limit of the user's ledger rows, newest
	// first, older than before when it is set.
	Transactions(ctx context.Context, userID string, before *Cursor, limit int) ([]Transaction, error)
}

// Totals is where a user's credits came from and went, over all time.
type Totals struct {
	Paid       int64 // bought: top-ups and subscription periods
	Gifted     int64 // admin grants less admin deductions, plus referral credits
	Trial      int64 // the sign-up trial
	Consumed   int64 // taken by AI calls, less refunds of failed calls
	ClawedBack int64 // taken back after Stripe refunds
}

// UserSummary is one row of the users list.
type UserSummary struct {
	Account
	// TrialSpendable is the part of the trial pool still usable now.
	TrialSpendable int64
	// Balance is what the user can spend now: both pools plus the spendable
	// trial. Negative when a refund or settle overran the top-up pool.
	Balance     int64
	Totals      Totals
	HadClawback bool
}

// ListParams is the admin's request for a page of users.
type ListParams struct {
	Query  string
	Sort   Sort
	Limit  int
	Offset int
}

// Page is one page of the users list.
type Page struct {
	Users []UserSummary
	Total int64
}

// Service builds the admin users views.
type Service struct {
	store      Store
	stripeLive bool
	now        func() time.Time
}

// NewService builds the service. stripeLive picks the Stripe Dashboard's live
// or test links.
func NewService(store Store, stripeLive bool, now func() time.Time) *Service {
	return &Service{store: store, stripeLive: stripeLive, now: now}
}

// Page sizes for the users list and a user's ledger.
const (
	DefaultLimit = 50
	MaxLimit     = 200
)

// ErrInvalidSort is returned for a sort the list does not know.
var ErrInvalidSort = errors.New("adminuser: unknown sort")

// ErrUserNotFound is returned for a user id with no account.
var ErrUserNotFound = errors.New("adminuser: no such user")

// clampLimit applies the default and the cap to a requested page size.
func clampLimit(limit int) int {
	if limit <= 0 {
		return DefaultLimit
	}
	return min(limit, MaxLimit)
}

// List returns one page of users with their balances and totals.
func (s *Service) List(ctx context.Context, p ListParams) (Page, error) {
	switch p.Sort {
	case "":
		p.Sort = SortCreated
	case SortCreated, SortLastLogin, SortBalance:
	default:
		return Page{}, ErrInvalidSort
	}
	q := ListQuery{Query: p.Query, Sort: p.Sort, Limit: clampLimit(p.Limit), Offset: max(p.Offset, 0)}
	accounts, total, err := s.store.ListAccounts(ctx, q)
	if err != nil {
		return Page{}, err
	}
	ids := make([]string, len(accounts))
	for i, a := range accounts {
		ids[i] = a.UserID
	}
	sums, err := s.store.LedgerSums(ctx, ids)
	if err != nil {
		return Page{}, err
	}
	page := Page{Users: make([]UserSummary, len(accounts)), Total: total}
	for i, a := range accounts {
		page.Users[i] = s.summarize(a, sums[a.UserID])
	}
	return page, nil
}

// UsageDays is how far back the detail page's usage goes, today included.
const UsageDays = 30

// DayCount is one UTC day's count.
type DayCount struct {
	Date  string // YYYY-MM-DD
	Count int64
}

// Detail is one user's page.
type Detail struct {
	UserSummary
	// StripeDashboardURL opens the customer in Stripe, where the amounts
	// live; "" for a user who never paid.
	StripeDashboardURL string
	// DailyLookups is the last UsageDays UTC days, oldest first, every day
	// present.
	DailyLookups []DayCount
	// AISpend is the credits AI calls took over the same days, by feature.
	AISpend map[string]int64
}

// Detail returns one user's summary, Stripe link and recent usage.
func (s *Service) Detail(ctx context.Context, userID string) (Detail, error) {
	a, ok, err := s.store.Account(ctx, userID)
	if err != nil {
		return Detail{}, err
	}
	if !ok {
		return Detail{}, ErrUserNotFound
	}
	sums, err := s.store.LedgerSums(ctx, []string{userID})
	if err != nil {
		return Detail{}, err
	}

	today := s.now().UTC().Truncate(24 * time.Hour)
	from, to := today.AddDate(0, 0, 1-UsageDays), today.AddDate(0, 0, 1)
	lookups, err := s.store.DailyLookups(ctx, userID, from, to)
	if err != nil {
		return Detail{}, err
	}
	spend, err := s.store.AISpend(ctx, userID, from, to)
	if err != nil {
		return Detail{}, err
	}

	d := Detail{
		UserSummary:        s.summarize(a, sums[userID]),
		StripeDashboardURL: s.stripeCustomerURL(a.StripeCustomerID),
		DailyLookups:       make([]DayCount, UsageDays),
		AISpend:            spend,
	}
	for i := range d.DailyLookups {
		date := from.AddDate(0, 0, i).Format(time.DateOnly)
		d.DailyLookups[i] = DayCount{Date: date, Count: lookups[date]}
	}
	return d, nil
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

func sourceOf(txnType string) Source {
	switch txnType {
	case "GRANT_TOPUP", "GRANT_SUBSCRIPTION":
		return SourceStripe
	case "GRANT_ADMIN", "DEDUCT_ADMIN":
		return SourceAdmin
	case "CLAWBACK":
		return SourceRefund
	case "GRANT_TRIAL", "EXPIRE":
		return SourceTrial
	case "GRANT_REFERRAL_BONUS", "GRANT_REFERRAL_REWARD":
		return SourceReferral
	case "CONSUME", "SETTLE", "REFUND":
		return SourceAI
	default:
		return SourceOther
	}
}

// ErrInvalidCursor is returned for a before cursor this service did not
// hand out.
var ErrInvalidCursor = errors.New("adminuser: malformed cursor")

// Entry is one ledger row with its source.
type Entry struct {
	Transaction
	Source Source
}

// LedgerPage is one page of a user's ledger. Next, when not "", is the
// before cursor of the following page.
type LedgerPage struct {
	Entries []Entry
	Next    string
}

// Transactions returns a page of userID's ledger, newest first. before is
// "" for the first page, then the previous page's Next.
func (s *Service) Transactions(ctx context.Context, userID, before string, limit int) (LedgerPage, error) {
	var cursor *Cursor
	if before != "" {
		c, err := parseCursor(before)
		if err != nil {
			return LedgerPage{}, err
		}
		cursor = &c
	}
	if _, ok, err := s.store.Account(ctx, userID); err != nil {
		return LedgerPage{}, err
	} else if !ok {
		return LedgerPage{}, ErrUserNotFound
	}

	limit = clampLimit(limit)
	rows, err := s.store.Transactions(ctx, userID, cursor, limit)
	if err != nil {
		return LedgerPage{}, err
	}
	page := LedgerPage{Entries: make([]Entry, len(rows))}
	for i, r := range rows {
		page.Entries[i] = Entry{Transaction: r, Source: sourceOf(r.Type)}
	}
	if len(rows) == limit {
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

func (s *Service) stripeCustomerURL(customerID string) string {
	if customerID == "" {
		return ""
	}
	if s.stripeLive {
		return "https://dashboard.stripe.com/customers/" + customerID
	}
	return "https://dashboard.stripe.com/test/customers/" + customerID
}

func (s *Service) summarize(a Account, sums map[string]LedgerSum) UserSummary {
	sum := func(types ...string) int64 {
		var n int64
		for _, t := range types {
			n += sums[t].Sum
		}
		return n
	}
	trial := spendableTrial(a, s.now())
	return UserSummary{
		Account:        a,
		TrialSpendable: trial,
		Balance:        a.SubscriptionBalance + a.TopupBalance + trial,
		Totals: Totals{
			Paid:       sum("GRANT_TOPUP", "GRANT_SUBSCRIPTION"),
			Gifted:     sum("GRANT_ADMIN", "DEDUCT_ADMIN", "GRANT_REFERRAL_BONUS", "GRANT_REFERRAL_REWARD"),
			Trial:      sum("GRANT_TRIAL"),
			Consumed:   -sum("CONSUME", "SETTLE", "REFUND"),
			ClawedBack: -sum("CLAWBACK"),
		},
		HadClawback: sums["CLAWBACK"].Count > 0,
	}
}

// spendableTrial is the trial pool's usable part (ADR-048): its balance,
// never below zero, until it expires.
func spendableTrial(a Account, at time.Time) int64 {
	if a.TrialExpiresAt == nil || !at.Before(*a.TrialExpiresAt) || a.TrialBalance < 0 {
		return 0
	}
	return a.TrialBalance
}
