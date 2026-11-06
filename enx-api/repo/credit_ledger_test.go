package repo

import (
	"context"
	"strings"
	"testing"
	"time"

	"enx-api/creditledger"
	"enx-api/utils/sqlitex"
)

func seedLedgerRow(t *testing.T, id, userID, txnType string, amount int64, total *int64, at time.Time) {
	t.Helper()
	if err := sqlitex.DB.Create(&sqlitex.CreditTransaction{
		Id: id, UserId: userID, Type: txnType, Amount: amount, TotalBalanceAfter: total, CreatedAt: at.UnixMilli(),
	}).Error; err != nil {
		t.Fatal(err)
	}
}

// readLedger walks the whole ledger page by page through the shared reader.
func readLedger(t *testing.T, userID, direction string, limit int) []creditledger.Entry {
	t.Helper()
	reader := creditledger.NewReader(CreditLedger{})
	var out []creditledger.Entry
	before := ""
	for range 20 {
		page, err := reader.Page(context.Background(), userID, before, direction, limit)
		if err != nil {
			t.Fatalf("Page(direction=%q, before=%q): %v", direction, before, err)
		}
		out = append(out, page.Entries...)
		if page.Next == "" {
			return out
		}
		before = page.Next
	}
	t.Fatal("ledger did not end")
	return nil
}

func entryIDs(entries []creditledger.Entry) string {
	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = e.ID
	}
	return strings.Join(ids, " ")
}

// ADR-063 Decision 2: "in" is amount > 0, "out" amount < 0; a zero-amount
// row shows only unfiltered. Filtering is server-side, so every page of a
// filtered walk is full and the cursor never skips or repeats a row.
func TestCreditLedgerDirectionFiltersAndPages(t *testing.T) {
	newAccountDB(t)
	base := time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC)
	seedLedgerRow(t, "trial", "u1", "GRANT_TRIAL", 100, nil, base)
	seedLedgerRow(t, "topup", "u1", "GRANT_TOPUP", 300, nil, base.Add(time.Minute))
	// Same millisecond: rowid breaks the tie.
	seedLedgerRow(t, "settle1", "u1", "SETTLE", -40, nil, base.Add(2*time.Minute))
	seedLedgerRow(t, "settle2", "u1", "SETTLE", -10, nil, base.Add(2*time.Minute))
	seedLedgerRow(t, "sub0", "u1", "GRANT_SUBSCRIPTION", 0, nil, base.Add(3*time.Minute))
	seedLedgerRow(t, "refund", "u1", "REFUND", 10, nil, base.Add(4*time.Minute))
	seedLedgerRow(t, "claw0", "u1", "CLAWBACK", 0, nil, base.Add(5*time.Minute))
	seedLedgerRow(t, "expire", "u1", "EXPIRE", -60, nil, base.Add(6*time.Minute))
	seedLedgerRow(t, "other", "u2", "GRANT_TOPUP", 500, nil, base.Add(7*time.Minute))
	seedLedgerRow(t, "other-out", "u2", "SETTLE", -5, nil, base.Add(7*time.Minute))

	for _, tc := range []struct {
		direction string
		want      string
	}{
		{"", "expire claw0 refund sub0 settle2 settle1 topup trial"},
		{"in", "refund topup trial"},
		{"out", "expire settle2 settle1"},
	} {
		for _, limit := range []int{1, 2, 50} {
			if got := entryIDs(readLedger(t, "u1", tc.direction, limit)); got != tc.want {
				t.Errorf("direction %q, limit %d: %q, want %q", tc.direction, limit, got, tc.want)
			}
		}
	}
}

// ADR-063 Decision 11: rows written before total_balance_after existed carry
// none.
func TestCreditLedgerReadsTotalBalanceAfter(t *testing.T) {
	newAccountDB(t)
	base := time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC)
	total := int64(260)
	seedLedgerRow(t, "old", "u1", "GRANT_TOPUP", 300, nil, base)
	seedLedgerRow(t, "new", "u1", "SETTLE", -40, &total, base.Add(time.Minute))

	entries := readLedger(t, "u1", "", 50)
	if len(entries) != 2 {
		t.Fatalf("entries = %q, want new old", entryIDs(entries))
	}
	if got := entries[0].TotalBalanceAfter; got == nil || *got != 260 {
		t.Errorf("new row total = %v, want 260", got)
	}
	if got := entries[1].TotalBalanceAfter; got != nil {
		t.Errorf("old row total = %d, want nil", *got)
	}
}
