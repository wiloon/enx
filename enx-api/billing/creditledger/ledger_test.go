package creditledger

import (
	"context"
	"errors"
	"testing"
	"time"
)

var now = time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC)

// fakeStore records the query it was given and returns no rows.
type fakeStore struct {
	got Query
}

func (f *fakeStore) Transactions(_ context.Context, _ string, q Query) ([]Transaction, error) {
	f.got = q
	return nil, nil
}

func TestPageHandsTheDirectionToTheStore(t *testing.T) {
	for _, tc := range []struct {
		direction string
		want      Direction
	}{
		{"", DirectionAll},
		{"in", DirectionIn},
		{"out", DirectionOut},
	} {
		t.Run(tc.direction, func(t *testing.T) {
			store := &fakeStore{}
			if _, err := NewReader(store).Page(context.Background(), "u1", "", tc.direction, 10); err != nil {
				t.Fatalf("Page: %v", err)
			}
			if store.got.Direction != tc.want {
				t.Fatalf("store got direction %q, want %q", store.got.Direction, tc.want)
			}
		})
	}
}

func TestPageRejectsAnUnknownDirection(t *testing.T) {
	for _, direction := range []string{"IN", "added", "all", " in"} {
		t.Run(direction, func(t *testing.T) {
			_, err := NewReader(&fakeStore{}).Page(context.Background(), "u1", "", direction, 10)
			if !errors.Is(err, ErrInvalidDirection) {
				t.Fatalf("Page(direction=%q) = %v, want ErrInvalidDirection", direction, err)
			}
		})
	}
}

func TestPageRejectsAMalformedCursor(t *testing.T) {
	_, err := NewReader(&fakeStore{}).Page(context.Background(), "u1", "not-a-cursor", "", 10)
	if !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("Page = %v, want ErrInvalidCursor", err)
	}
}

func TestPageSizeDefaultsAndIsCapped(t *testing.T) {
	for _, tc := range []struct{ limit, want int }{{0, DefaultLimit}, {-1, DefaultLimit}, {7, 7}, {500, MaxLimit}} {
		store := &fakeStore{}
		if _, err := NewReader(store).Page(context.Background(), "u1", "", "", tc.limit); err != nil {
			t.Fatalf("Page: %v", err)
		}
		if store.got.Limit != tc.want {
			t.Errorf("limit %d: store got %d, want %d", tc.limit, store.got.Limit, tc.want)
		}
	}
}

// ADR-063 Decision 5: the user sees the admin's reason on an admin grant or
// deduction, and no other note (a CLAWBACK's note is a Stripe charge id).
func TestForUserKeepsOnlyAnAdminRowsNote(t *testing.T) {
	total := int64(120)
	for _, tc := range []struct {
		txnType, note, want string
	}{
		{"GRANT_ADMIN", "support comp", "support comp"},
		{"DEDUCT_ADMIN", "duplicate grant", "duplicate grant"},
		{"CLAWBACK", "ch_123", ""},
		{"GRANT_TOPUP", "pi_123", ""},
		{"SETTLE", "anything", ""},
	} {
		t.Run(tc.txnType, func(t *testing.T) {
			row := Transaction{
				ID: "t1", Seq: 1, UserID: "u1", Type: tc.txnType, Amount: -5, BalanceAfter: 99,
				TotalBalanceAfter: &total, Feature: "f", Note: tc.note, CreatedAt: now,
			}
			got := ForUser(row)
			want := UserTransaction{CreatedAt: now, Type: tc.txnType, Feature: "f", Amount: -5, TotalBalanceAfter: &total, Note: tc.want}
			if got.CreatedAt != want.CreatedAt || got.Type != want.Type || got.Feature != want.Feature ||
				got.Amount != want.Amount || got.TotalBalanceAfter != want.TotalBalanceAfter || got.Note != want.Note {
				t.Fatalf("ForUser = %+v, want %+v", got, want)
			}
		})
	}
}
