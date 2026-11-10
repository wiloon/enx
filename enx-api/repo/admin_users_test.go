package repo

import (
	"context"
	"fmt"
	"sort"
	"testing"
	"time"

	"enx-api/adminuser"
	"enx-api/utils/sqlitex"
)

func listAdminUsers(t *testing.T, q adminuser.ListQuery) ([]string, int64) {
	t.Helper()
	if q.Limit == 0 {
		q.Limit = 50
	}
	accounts, total, err := AdminUsers{Now: time.Now}.ListAccounts(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, len(accounts))
	for i, a := range accounts {
		ids[i] = a.UserID
	}
	sort.Strings(ids)
	return ids, total
}

// #211: the admin search box takes an email substring or a user's exact enx
// id, which support gets from the user's /account page.
func TestAdminUsersListAccounts_QueryMatchesEmailSubstringOrExactID(t *testing.T) {
	newAccountDB(t)
	seedAccount(t, "6f1c2d3e-aaaa", "bob_x@example.com")
	seedAccount(t, "6f1c2d3e-bbbb", "bobyx@example.com")
	seedAccount(t, "9d8e7f6a-cccc", "carol@example.org")
	// Not a Clerk user: never listed.
	if err := sqlitex.DB.Create(&sqlitex.User{Id: "6f1c2d3e-dddd", Name: "legacy", Email: "legacy@example.com"}).Error; err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name  string
		query string
		limit int
		want  string
		total int64
	}{
		{"full id", "9d8e7f6a-cccc", 0, "[9d8e7f6a-cccc]", 1},
		{"partial id", "6f1c2d3e", 0, "[]", 0},
		{"id of a non-Clerk user", "6f1c2d3e-dddd", 0, "[]", 0},
		{"email substring", "example.com", 0, "[6f1c2d3e-aaaa 6f1c2d3e-bbbb]", 2},
		{"LIKE wildcards match literally", "b_x", 0, "[6f1c2d3e-aaaa]", 1},
		{"total counts past the page", "example", 1, "", 3},
		{"empty query lists everyone", "", 0, "[6f1c2d3e-aaaa 6f1c2d3e-bbbb 9d8e7f6a-cccc]", 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ids, total := listAdminUsers(t, adminuser.ListQuery{Query: tc.query, Sort: adminuser.SortCreated, Limit: tc.limit})
			if total != tc.total {
				t.Fatalf("total = %d, want %d", total, tc.total)
			}
			if tc.want != "" && fmt.Sprint(ids) != tc.want {
				t.Fatalf("ids = %v, want %s", ids, tc.want)
			}
			if tc.limit > 0 && len(ids) != tc.limit {
				t.Fatalf("page holds %d users, want %d", len(ids), tc.limit)
			}
		})
	}
}

func seedCreditRow(t *testing.T, id, userID, txnType, feature string, amount int64, at time.Time) {
	t.Helper()
	if err := sqlitex.DB.Create(&sqlitex.CreditTransaction{
		Id: id, UserId: userID, Type: txnType, Feature: feature, Amount: amount, CreatedAt: at.UnixMilli(),
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestAdminUsersLedgerSumsTotalsEachAskedUsersRowsByType(t *testing.T) {
	newAccountDB(t)
	at := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	seedCreditRow(t, "t1", "u1", "GRANT_TOPUP", "", 300, at)
	seedCreditRow(t, "t2", "u1", "GRANT_TOPUP", "", 200, at)
	seedCreditRow(t, "t3", "u1", "SETTLE", "translate_sentence", -40, at)
	seedCreditRow(t, "t4", "u2", "GRANT_ADMIN", "", 5, at)
	seedCreditRow(t, "t5", "u3", "GRANT_TOPUP", "", 999, at)

	sums, err := AdminUsers{}.LedgerSums(context.Background(), []string{"u1", "u2", "u4"})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]map[string]adminuser.LedgerSum{
		"u1": {"GRANT_TOPUP": {Sum: 500, Count: 2}, "SETTLE": {Sum: -40, Count: 1}},
		"u2": {"GRANT_ADMIN": {Sum: 5, Count: 1}},
	}
	if fmt.Sprint(sums) != fmt.Sprint(want) {
		t.Fatalf("sums = %v, want %v (u3 not asked for, u4 has no rows)", sums, want)
	}
	if sums, err := (AdminUsers{}).LedgerSums(context.Background(), nil); err != nil || len(sums) != 0 {
		t.Fatalf("no users: %v, %v; want an empty map", sums, err)
	}
}

func TestAdminUsersDailyLookupsCountsTheUsersLookupsByUTCDateInTheRange(t *testing.T) {
	newAccountDB(t)
	from := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 2)
	for _, e := range []struct {
		user string
		at   time.Time
	}{
		{"u1", from.Add(-time.Millisecond)},
		{"u1", from},
		{"u1", from.Add(24*time.Hour - time.Millisecond)},
		{"u1", from.Add(36 * time.Hour)},
		{"u1", to},
		{"u2", from.Add(time.Hour)},
	} {
		if err := AddLookupEvent(context.Background(), sqlitex.LookupEvent{UserID: e.user, At: e.at.UnixMilli(), Outcome: "allowed"}); err != nil {
			t.Fatal(err)
		}
	}

	got, err := AdminUsers{}.DailyLookups(context.Background(), "u1", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if want := map[string]int64{"2026-10-01": 2, "2026-10-02": 1}; fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("daily lookups = %v, want %v (from inclusive, to exclusive, u1 only)", got, want)
	}
}

func TestAdminUsersAISpendTotalsTheUsersAICreditsByFeatureInTheRange(t *testing.T) {
	newAccountDB(t)
	from := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 30)
	seedCreditRow(t, "settle", "u1", "SETTLE", "translate_sentence", -40, from)
	seedCreditRow(t, "consume", "u1", "CONSUME", "translate_sentence", -10, from.Add(time.Hour))
	seedCreditRow(t, "refund", "u1", "REFUND", "translate_sentence", 5, from.Add(2*time.Hour))
	seedCreditRow(t, "rephrase", "u1", "SETTLE", "rephrase", -7, from.Add(3*time.Hour))
	seedCreditRow(t, "topup", "u1", "GRANT_TOPUP", "", 300, from.Add(4*time.Hour))
	seedCreditRow(t, "before", "u1", "SETTLE", "translate_sentence", -1000, from.Add(-time.Millisecond))
	seedCreditRow(t, "after", "u1", "SETTLE", "translate_sentence", -1000, to)
	seedCreditRow(t, "other", "u2", "SETTLE", "translate_sentence", -1000, from)

	got, err := AdminUsers{}.AISpend(context.Background(), "u1", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if want := map[string]int64{"rephrase": 7, "translate_sentence": 45}; fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("AI spend = %v, want %v", got, want)
	}
}

func TestAdminUsersListAccountsSortsByBalanceAndLastLogin(t *testing.T) {
	newAccountDB(t)
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	live, expired := now.Add(time.Hour).Unix(), now.Add(-time.Hour).Unix()
	for _, u := range []struct {
		id        string
		lastLogin time.Time
		account   *sqlitex.CreditAccount
	}{
		{"a", now.Add(-3 * time.Hour), &sqlitex.CreditAccount{SubscriptionBalance: 10, TopupBalance: 5}},
		{"b", now.Add(-1 * time.Hour), &sqlitex.CreditAccount{TrialBalance: 100, TrialExpiresAt: &expired}},
		{"c", now.Add(-4 * time.Hour), &sqlitex.CreditAccount{TrialBalance: 30, TrialExpiresAt: &live}},
		{"d", now.Add(-2 * time.Hour), nil},
	} {
		if err := sqlitex.DB.Create(&sqlitex.User{
			Id: u.id, ClerkUserID: "user_" + u.id, Email: u.id + "@example.com", Status: "active", CreatedAt: now, LastLoginTime: u.lastLogin,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if u.account != nil {
			u.account.UserId, u.account.UpdatedAt = u.id, 1
			if err := sqlitex.DB.Create(u.account).Error; err != nil {
				t.Fatal(err)
			}
		}
	}

	for _, tc := range []struct {
		sort adminuser.Sort
		want string
	}{
		{adminuser.SortBalance, "[c a b d]"},
		{adminuser.SortLastLogin, "[b d a c]"},
	} {
		accounts, _, err := AdminUsers{Now: func() time.Time { return now }}.ListAccounts(context.Background(), adminuser.ListQuery{Sort: tc.sort, Limit: 50})
		if err != nil {
			t.Fatal(err)
		}
		ids := make([]string, len(accounts))
		for i, a := range accounts {
			ids[i] = a.UserID
		}
		if fmt.Sprint(ids) != tc.want {
			t.Errorf("sort %s: %v, want %s", tc.sort, ids, tc.want)
		}
	}
}
