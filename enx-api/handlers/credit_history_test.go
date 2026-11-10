package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"enx-api/creditledger"

	"github.com/gin-gonic/gin"
)

type fakeCreditLedger struct {
	rows   []creditledger.Transaction
	err    error
	called bool
	user   string
	query  creditledger.Query
}

func (f *fakeCreditLedger) Transactions(_ context.Context, userID string, q creditledger.Query) ([]creditledger.Transaction, error) {
	f.called, f.user, f.query = true, userID, q
	return f.rows, f.err
}

func serveCreditHistory(ledger *fakeCreditLedger, query string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/me/credits/transactions?"+query, nil)
	c.Set("user_id", "u1")
	NewCreditHistoryHandler(creditledger.NewReader(ledger)).List(c)
	return w
}

// ADR-063 Decision 5: the user's own rows carry no ids, per-pool balance or
// source, a note only on admin rows, a null total on rows older than the
// total, and the time in UTC.
func TestCreditHistoryShowsEachRowWithTheUsersFieldsOnly(t *testing.T) {
	east := time.FixedZone("UTC+8", 8*3600)
	total := int64(285)
	ledger := &fakeCreditLedger{rows: []creditledger.Transaction{
		{ID: "t3", Seq: 3, UserID: "u1", Type: "GRANT_ADMIN", Amount: 25, BalanceAfter: 999, TotalBalanceAfter: &total, Note: "support comp",
			CreatedAt: time.Date(2026, 11, 6, 12, 0, 0, 123_000_000, east)},
		{ID: "t2", Seq: 2, UserID: "u1", Type: "SETTLE", Feature: "translate_sentence", Amount: -40, BalanceAfter: 999, TotalBalanceAfter: &total,
			CreatedAt: time.Date(2026, 11, 6, 11, 0, 0, 0, east)},
		{ID: "t1", Seq: 1, UserID: "u1", Type: "CLAWBACK", Amount: -90, BalanceAfter: 999, Note: "ch_secret",
			CreatedAt: time.Date(2026, 11, 6, 10, 0, 0, 0, east)},
	}}

	w := serveCreditHistory(ledger, "")

	want := `{"next":"","success":true,"transactions":[` +
		`{"createdAt":"2026-11-06T04:00:00.123Z","type":"GRANT_ADMIN","feature":"","amount":25,"totalBalanceAfter":285,"note":"support comp"},` +
		`{"createdAt":"2026-11-06T03:00:00Z","type":"SETTLE","feature":"translate_sentence","amount":-40,"totalBalanceAfter":285},` +
		`{"createdAt":"2026-11-06T02:00:00Z","type":"CLAWBACK","feature":"","amount":-90,"totalBalanceAfter":null}]}`
	if w.Code != http.StatusOK || w.Body.String() != want {
		t.Fatalf("got %d %s\nwant 200 %s", w.Code, w.Body.String(), want)
	}
	if ledger.user != "u1" {
		t.Fatalf("read the ledger of %q, want the signed-in user u1", ledger.user)
	}
}

func TestCreditHistoryWithNoRowsIsAnEmptyList(t *testing.T) {
	w := serveCreditHistory(&fakeCreditLedger{}, "")
	if want := `{"next":"","success":true,"transactions":[]}`; w.Code != http.StatusOK || w.Body.String() != want {
		t.Fatalf("got %d %s, want 200 %s", w.Code, w.Body.String(), want)
	}
}

func TestCreditHistoryPassesThePageRequestToTheLedger(t *testing.T) {
	at := time.UnixMilli(1_790_000_000_000)
	ledger := &fakeCreditLedger{rows: []creditledger.Transaction{
		{ID: "t9", Seq: 9, Type: "SETTLE", Amount: -1, CreatedAt: at.Add(time.Second)},
		{ID: "t8", Seq: 8, Type: "SETTLE", Amount: -1, CreatedAt: at},
	}}

	w := serveCreditHistory(ledger, "limit=2&before=1790000005000_12&direction=out")

	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"next":"1790000000000_8"`) {
		t.Fatalf("got %d %s, want 200 with the next cursor after t8", w.Code, w.Body.String())
	}
	q := ledger.query
	if q.Limit != 2 || q.Direction != creditledger.DirectionOut || q.Before == nil ||
		q.Before.CreatedAt.UnixMilli() != 1_790_000_005_000 || q.Before.Seq != 12 {
		t.Fatalf("ledger query = %+v (before %+v), want limit 2, out, before 1790000005000_12", q, q.Before)
	}
}

// ADR-063 Decision 2: an unknown direction is a client bug, so it fails
// instead of showing the unfiltered list.
func TestCreditHistoryRejectsBadParametersWithoutReadingTheLedger(t *testing.T) {
	for _, query := range []string{"direction=added", "before=not-a-cursor", "limit=abc"} {
		ledger := &fakeCreditLedger{}
		w := serveCreditHistory(ledger, query)
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"success":false`) {
			t.Errorf("?%s: got %d %s, want 400", query, w.Code, w.Body.String())
		}
		if ledger.called {
			t.Errorf("?%s: the ledger was read", query)
		}
	}
}

func TestCreditHistoryLedgerFailureIs500WithoutTheError(t *testing.T) {
	w := serveCreditHistory(&fakeCreditLedger{err: errors.New("disk I/O error")}, "")
	if w.Code != http.StatusInternalServerError || strings.Contains(w.Body.String(), "disk") {
		t.Fatalf("got %d %s, want 500 without the cause", w.Code, w.Body.String())
	}
}
