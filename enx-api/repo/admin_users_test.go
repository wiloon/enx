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
