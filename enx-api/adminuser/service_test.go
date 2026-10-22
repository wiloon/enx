package adminuser

import (
	"context"
	"sort"
	"strings"
	"testing"
	"time"
)

var now = time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)

// fakeStore keeps accounts and ledger rows in memory.
type fakeStore struct {
	accounts []Account
	ledger   []Transaction
	lookups  map[string]map[string]int64 // user -> UTC date -> count
	spend    map[string]map[string]int64 // user -> feature -> credits
}

func (f *fakeStore) ListAccounts(_ context.Context, q ListQuery) ([]Account, int64, error) {
	var matched []Account
	for _, a := range f.accounts {
		if strings.Contains(a.Email, q.Query) {
			matched = append(matched, a)
		}
	}
	sort.SliceStable(matched, func(i, j int) bool { return matched[i].CreatedAt.After(matched[j].CreatedAt) })
	total := int64(len(matched))
	if q.Offset >= len(matched) {
		return nil, total, nil
	}
	matched = matched[q.Offset:]
	if len(matched) > q.Limit {
		matched = matched[:q.Limit]
	}
	return matched, total, nil
}

func (f *fakeStore) LedgerSums(_ context.Context, userIDs []string) (map[string]map[string]LedgerSum, error) {
	out := map[string]map[string]LedgerSum{}
	for _, id := range userIDs {
		out[id] = map[string]LedgerSum{}
	}
	for _, t := range f.ledger {
		if sums, ok := out[t.UserID]; ok {
			s := sums[t.Type]
			s.Sum += t.Amount
			s.Count++
			sums[t.Type] = s
		}
	}
	return out, nil
}

func (f *fakeStore) Account(_ context.Context, userID string) (Account, bool, error) {
	for _, a := range f.accounts {
		if a.UserID == userID {
			return a, true, nil
		}
	}
	return Account{}, false, nil
}

func (f *fakeStore) DailyLookups(_ context.Context, userID string, _, _ time.Time) (map[string]int64, error) {
	return f.lookups[userID], nil
}

func (f *fakeStore) AISpend(_ context.Context, userID string, _, _ time.Time) (map[string]int64, error) {
	return f.spend[userID], nil
}

func (f *fakeStore) Transactions(_ context.Context, userID string, before *Cursor, limit int) ([]Transaction, error) {
	var out []Transaction
	for i := len(f.ledger) - 1; i >= 0; i-- {
		t := f.ledger[i]
		if t.UserID != userID {
			continue
		}
		if before != nil && !t.olderThan(*before) {
			continue
		}
		out = append(out, t)
		if len(out) == limit {
			break
		}
	}
	return out, nil
}

// recordingStore remembers the query List sent.
type recordingStore struct {
	fakeStore
	got ListQuery
}

func (r *recordingStore) ListAccounts(ctx context.Context, q ListQuery) ([]Account, int64, error) {
	r.got = q
	return r.fakeStore.ListAccounts(ctx, q)
}

func TestListPageBounds(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   ListParams
		want ListQuery
	}{
		{"defaults", ListParams{}, ListQuery{Sort: SortCreated, Limit: 50}},
		{"limit capped", ListParams{Limit: 500}, ListQuery{Sort: SortCreated, Limit: 200}},
		{"negative offset", ListParams{Offset: -3, Limit: 10}, ListQuery{Sort: SortCreated, Limit: 10}},
		{"query and sort pass through", ListParams{Query: "ex", Sort: SortBalance, Offset: 50}, ListQuery{Query: "ex", Sort: SortBalance, Limit: 50, Offset: 50}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &recordingStore{}
			if _, err := NewService(store, false, func() time.Time { return now }).List(context.Background(), tc.in); err != nil {
				t.Fatalf("List: %v", err)
			}
			if store.got != tc.want {
				t.Fatalf("store query = %+v, want %+v", store.got, tc.want)
			}
		})
	}
}

func TestListRejectsUnknownSort(t *testing.T) {
	_, err := NewService(&fakeStore{}, false, func() time.Time { return now }).List(context.Background(), ListParams{Sort: "email"})
	if err != ErrInvalidSort {
		t.Fatalf("List = %v, want ErrInvalidSort", err)
	}
}

func TestListEmptyResultIsAnEmptyPage(t *testing.T) {
	page, err := NewService(&fakeStore{}, false, func() time.Time { return now }).List(context.Background(), ListParams{Query: "nobody"})
	if err != nil || len(page.Users) != 0 || page.Total != 0 {
		t.Fatalf("List = %+v, %v; want an empty page", page, err)
	}
}

// ADR-048: an expired trial is gone, whatever its stored balance.
func TestListBalanceCountsTheTrialOnlyUntilItExpires(t *testing.T) {
	later, earlier := now.Add(time.Hour), now.Add(-time.Hour)
	store := &fakeStore{accounts: []Account{
		{UserID: "live", Email: "l@example.com", TopupBalance: 10, TrialBalance: 100, TrialExpiresAt: &later, CreatedAt: now},
		{UserID: "expired", Email: "e@example.com", TopupBalance: 10, TrialBalance: 100, TrialExpiresAt: &earlier, CreatedAt: earlier},
	}}
	page, err := NewService(store, false, func() time.Time { return now }).List(context.Background(), ListParams{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	got := map[string]int64{}
	for _, u := range page.Users {
		got[u.UserID] = u.Balance
	}
	if got["live"] != 110 || got["expired"] != 10 {
		t.Fatalf("balances = %v, want live=110 expired=10", got)
	}
}

func TestDetailStripeLinkFollowsTheKeyMode(t *testing.T) {
	store := &fakeStore{accounts: []Account{
		{UserID: "paying", StripeCustomerID: "cus_123"},
		{UserID: "free"},
	}}
	for _, tc := range []struct {
		live bool
		user string
		want string
	}{
		{false, "paying", "https://dashboard.stripe.com/test/customers/cus_123"},
		{true, "paying", "https://dashboard.stripe.com/customers/cus_123"},
		{true, "free", ""},
	} {
		d, err := NewService(store, tc.live, func() time.Time { return now }).Detail(context.Background(), tc.user)
		if err != nil {
			t.Fatalf("Detail(%s): %v", tc.user, err)
		}
		if d.StripeDashboardURL != tc.want {
			t.Errorf("live=%v user=%s: link = %q, want %q", tc.live, tc.user, d.StripeDashboardURL, tc.want)
		}
	}
}

func TestDetailUsageCoversThirtyUTCDaysZeroFilled(t *testing.T) {
	store := &fakeStore{
		accounts: []Account{{UserID: "u1"}},
		lookups:  map[string]map[string]int64{"u1": {"2026-10-16": 4, "2026-09-17": 2, "2026-09-16": 9}},
		spend:    map[string]map[string]int64{"u1": {"translate_sentence": 120, "idiom_notes": 30}},
	}
	d, err := NewService(store, false, func() time.Time { return now }).Detail(context.Background(), "u1")
	if err != nil {
		t.Fatalf("Detail: %v", err)
	}

	if len(d.DailyLookups) != 30 {
		t.Fatalf("days = %d, want 30", len(d.DailyLookups))
	}
	first, last := d.DailyLookups[0], d.DailyLookups[29]
	if first != (DayCount{"2026-09-17", 2}) || last != (DayCount{"2026-10-16", 4}) {
		t.Fatalf("first=%+v last=%+v, want 2026-09-17:2 and 2026-10-16:4 (09-16 is outside)", first, last)
	}
	if d.DailyLookups[1] != (DayCount{"2026-09-18", 0}) {
		t.Fatalf("day 2 = %+v, want 2026-09-18:0", d.DailyLookups[1])
	}
	if d.AISpend["translate_sentence"] != 120 || d.AISpend["idiom_notes"] != 30 {
		t.Fatalf("AI spend = %v", d.AISpend)
	}
}

func TestDetailUnknownUserIsNotFound(t *testing.T) {
	_, err := NewService(&fakeStore{}, false, func() time.Time { return now }).Detail(context.Background(), "nobody")
	if err != ErrUserNotFound {
		t.Fatalf("Detail = %v, want ErrUserNotFound", err)
	}
}

func TestTransactionsPageNewestFirstWithSources(t *testing.T) {
	at := func(min int) time.Time { return now.Add(time.Duration(min) * time.Minute) }
	store := &fakeStore{
		accounts: []Account{{UserID: "u1"}},
		ledger: []Transaction{
			{ID: "t1", Seq: 1, UserID: "u1", Type: "GRANT_TRIAL", Amount: 100, CreatedAt: at(1)},
			{ID: "t2", Seq: 2, UserID: "u1", Type: "GRANT_TOPUP", Amount: 300, CreatedAt: at(2)},
			{ID: "t3", Seq: 3, UserID: "u1", Type: "SETTLE", Amount: -40, CreatedAt: at(3)},
			{ID: "t4", Seq: 4, UserID: "u1", Type: "CLAWBACK", Amount: -90, CreatedAt: at(4)},
			{ID: "t5", Seq: 5, UserID: "u1", Type: "GRANT_ADMIN", Amount: 50, CreatedAt: at(5)},
		},
	}
	svc := NewService(store, false, func() time.Time { return now })
	ctx := context.Background()

	var got []string
	before := ""
	for range 3 {
		page, err := svc.Transactions(ctx, "u1", before, 2)
		if err != nil {
			t.Fatalf("Transactions(before=%q): %v", before, err)
		}
		for _, e := range page.Entries {
			got = append(got, e.ID+":"+string(e.Source))
		}
		if page.Next == "" {
			break
		}
		before = page.Next
	}

	want := "t5:admin t4:refund t3:ai t2:stripe t1:trial"
	if strings.Join(got, " ") != want {
		t.Fatalf("entries = %q, want %q", strings.Join(got, " "), want)
	}
}

func TestTransactionsRejectsAMalformedCursor(t *testing.T) {
	store := &fakeStore{accounts: []Account{{UserID: "u1"}}}
	_, err := NewService(store, false, func() time.Time { return now }).Transactions(context.Background(), "u1", "not-a-cursor", 10)
	if err != ErrInvalidCursor {
		t.Fatalf("Transactions = %v, want ErrInvalidCursor", err)
	}
}

func TestTransactionsUnknownUserIsNotFound(t *testing.T) {
	_, err := NewService(&fakeStore{}, false, func() time.Time { return now }).Transactions(context.Background(), "nobody", "", 10)
	if err != ErrUserNotFound {
		t.Fatalf("Transactions = %v, want ErrUserNotFound", err)
	}
}

func row(userID, txnType string, amount int64) Transaction {
	return Transaction{UserID: userID, Type: txnType, Amount: amount}
}

func TestListTotalsSplitPaidGiftedTrialAndConsumed(t *testing.T) {
	store := &fakeStore{
		accounts: []Account{{UserID: "u1", Email: "a@example.com", SubscriptionBalance: 100, TopupBalance: -20}},
		ledger: []Transaction{
			row("u1", "GRANT_SUBSCRIPTION", 500),
			row("u1", "GRANT_TOPUP", 300),
			row("u1", "GRANT_ADMIN", 50),
			row("u1", "DEDUCT_ADMIN", -10),
			row("u1", "GRANT_TRIAL", 100),
			row("u1", "SETTLE", -700),
			row("u1", "CONSUME", -40),
			row("u1", "REFUND", 15),
			row("u1", "CLAWBACK", -90),
		},
	}
	svc := NewService(store, false, func() time.Time { return now })

	page, err := svc.List(context.Background(), ListParams{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(page.Users) != 1 {
		t.Fatalf("users = %d, want 1", len(page.Users))
	}
	got := page.Users[0]
	want := Totals{Paid: 800, Gifted: 40, Trial: 100, Consumed: 725, ClawedBack: 90}
	if got.Totals != want {
		t.Fatalf("totals = %+v, want %+v", got.Totals, want)
	}
	if !got.HadClawback || got.Balance != 80 {
		t.Fatalf("hadClawback=%v balance=%d, want true and 80 (100 − 20, no trial)", got.HadClawback, got.Balance)
	}
}

// ADR-051: invite credits are gifts, not purchases or the sign-up trial.
func TestListTotalsCountReferralCreditsAsGifted(t *testing.T) {
	store := &fakeStore{
		accounts: []Account{{UserID: "u1", Email: "a@example.com"}},
		ledger: []Transaction{
			row("u1", "GRANT_TRIAL", 100),
			row("u1", "GRANT_REFERRAL_BONUS", 100),
			row("u1", "GRANT_REFERRAL_REWARD", 300),
			row("u1", "GRANT_ADMIN", 5),
		},
	}
	page, err := NewService(store, false, func() time.Time { return now }).List(context.Background(), ListParams{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if got, want := page.Users[0].Totals, (Totals{Gifted: 405, Trial: 100}); got != want {
		t.Fatalf("totals = %+v, want %+v", got, want)
	}
}
