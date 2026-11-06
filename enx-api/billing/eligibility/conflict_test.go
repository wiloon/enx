package eligibility

import (
	"errors"
	"testing"
)

func TestBlockingConflict(t *testing.T) {
	cases := []struct {
		name    string
		owned   []Owned
		want    string
		wantErr error
	}{
		{name: "no conflict", owned: []Owned{{ID: "sub_a", Live: live("active")}}, want: ""},
		{name: "an open conflict blocks even after Stripe ended it", owned: []Owned{{ID: "sub_b", Conflict: ConflictOpen, Live: live("canceled")}}, want: "sub_b"},
		{name: "an open conflict blocks without a live lookup", owned: []Owned{{ID: "sub_b", Conflict: ConflictOpen}}, want: "sub_b"},
		{name: "a resolved conflict still billable blocks", owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, Live: live("past_due")}}, want: "sub_b"},
		{name: "a resolved conflict with a period-end cancellation still blocks while billable", owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, Live: &Live{Status: "active", CancelAtPeriodEnd: true}}}, want: "sub_b"},
		{name: "a resolved conflict Stripe canceled does not block", owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, Live: live("canceled")}}, want: ""},
		{name: "a resolved conflict stored as canceled does not block", owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, StoredStatus: "canceled"}}, want: ""},
		{name: "a resolved conflict whose live state is unknown fails closed", owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, StoredStatus: "active"}}, wantErr: ErrLiveStateUnknown},
		{name: "a paused resolved conflict needs a retryable decision", owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, Live: live("paused")}}, wantErr: ErrLiveStateUnknown},
		{name: "an unrecognized resolved conflict needs a retryable decision", owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, Live: live("future_status")}}, wantErr: ErrLiveStateUnknown},
		{name: "an empty resolved live status needs a retryable decision", owned: []Owned{{ID: "sub_b", Conflict: ConflictResolved, Live: live("")}}, wantErr: ErrLiveStateUnknown},
		{
			name: "a known blocking conflict wins over another's unknown state",
			owned: []Owned{
				{ID: "sub_b", Conflict: ConflictResolved, StoredStatus: "active"},
				{ID: "sub_c", Conflict: ConflictOpen},
			},
			want: "sub_c",
		},
		{
			name: "the smallest blocking ID wins whatever the store order",
			owned: []Owned{
				{ID: "sub_z", Conflict: ConflictOpen},
				{ID: "sub_m", Conflict: ConflictResolved, Live: live("active")},
				{ID: "sub_c", Conflict: ConflictResolved, Live: live("canceled")},
				{ID: "sub_d", Conflict: ConflictResolved, StoredStatus: "active"},
				{ID: "sub_n", Conflict: ConflictOpen, Live: live("canceled")},
			},
			want: "sub_m",
		},
		{
			name: "ended, unconflicted and unknown rows are no candidates",
			owned: []Owned{
				{ID: "sub_a", Conflict: NoConflict, Live: live("active")},
				{ID: "sub_b", Conflict: ConflictResolved, Live: live("canceled")},
				{ID: "sub_c", Conflict: ConflictResolved, StoredStatus: "active"},
			},
			wantErr: ErrLiveStateUnknown,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := BlockingConflict(tc.owned)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("BlockingConflict error = %v, want %v", err, tc.wantErr)
			}
			if got != tc.want {
				t.Fatalf("BlockingConflict = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestKnownBlockingConflictsWinOverIndeterminateLiveStatusesInEitherOrder(t *testing.T) {
	for _, status := range []string{"paused", "future_status", ""} {
		t.Run(status, func(t *testing.T) {
			owned := []Owned{
				{ID: "sub_a", Conflict: ConflictResolved, Live: live(status)},
				{ID: "sub_z", Conflict: ConflictOpen},
				{ID: "sub_m", Conflict: ConflictResolved, Live: live("past_due")},
			}
			for i := 0; i < 2; i++ {
				id, err := BlockingConflict(owned)
				if err != nil || id != "sub_m" {
					t.Fatalf("BlockingConflict = %q, %v; want sub_m in order %d", id, err, i)
				}
				owned[0], owned[2] = owned[2], owned[0]
			}
		})
	}
}
