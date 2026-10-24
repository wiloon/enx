package conflict

import (
	"errors"
	"strings"
	"testing"
	"time"
)

var (
	discovered = time.Date(2026, 10, 24, 9, 0, 0, 0, time.UTC)
	resolvedAt = time.Date(2026, 10, 25, 9, 0, 0, 0, time.UTC)
	later      = time.Date(2026, 10, 26, 9, 0, 0, 0, time.UTC)
)

func TestResolve(t *testing.T) {
	resolved := Resolution{Status: Resolved, ResolverID: "admin_1", ResolvedAt: resolvedAt, Notes: "Refunded sub_b in Stripe and canceled it."}

	cases := []struct {
		name        string
		current     Resolution
		req         ResolveRequest
		want        Resolution
		wantChanged bool
		wantErr     error
	}{
		{
			name:        "an open conflict is resolved with the operator, the time and the notes",
			current:     Resolution{Status: Open},
			req:         ResolveRequest{Status: "resolved", Notes: "Refunded sub_b in Stripe and canceled it."},
			want:        resolved,
			wantChanged: true,
		},
		{
			name:        "notes are stored trimmed",
			current:     Resolution{Status: Open},
			req:         ResolveRequest{Status: "resolved", Notes: "  Refunded sub_b in Stripe and canceled it.\n"},
			want:        resolved,
			wantChanged: true,
		},
		{
			name:    "the identical resolution repeated is a no-op that keeps the first operator and time",
			current: resolved,
			req:     ResolveRequest{Status: "resolved", Notes: "Refunded sub_b in Stripe and canceled it."},
			want:    resolved,
		},
		{
			name:    "a different later resolution is refused",
			current: resolved,
			req:     ResolveRequest{Status: "resolved", Notes: "Something else."},
			want:    resolved,
			wantErr: ErrResolutionDiffers,
		},
		{
			name:    "a resolved conflict is never reopened",
			current: resolved,
			req:     ResolveRequest{Status: "open", Notes: "Reopen it."},
			want:    resolved,
			wantErr: ErrInvalidStatus,
		},
		{
			name:    "open is not a resolution",
			current: Resolution{Status: Open},
			req:     ResolveRequest{Status: "open", Notes: "Still looking."},
			want:    Resolution{Status: Open},
			wantErr: ErrInvalidStatus,
		},
		{
			name:    "an unknown status is refused",
			current: Resolution{Status: Open},
			req:     ResolveRequest{Status: "canceled", Notes: "Canceled."},
			want:    Resolution{Status: Open},
			wantErr: ErrInvalidStatus,
		},
		{
			name:    "blank notes are refused",
			current: Resolution{Status: Open},
			req:     ResolveRequest{Status: "resolved", Notes: " \t\n"},
			want:    Resolution{Status: Open},
			wantErr: ErrBlankNotes,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, changed, err := Resolve(tc.current, tc.req, "admin_1", resolvedAt)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if got != tc.want || changed != tc.wantChanged {
				t.Errorf("Resolve = %+v, changed %v; want %+v, changed %v", got, changed, tc.want, tc.wantChanged)
			}
		})
	}
}

func TestResolveRepeatedByAnotherOperatorKeepsTheFirst(t *testing.T) {
	first, _, err := Resolve(Resolution{Status: Open}, ResolveRequest{Status: "resolved", Notes: "Done."}, "admin_1", resolvedAt)
	if err != nil {
		t.Fatal(err)
	}
	got, changed, err := Resolve(first, ResolveRequest{Status: "resolved", Notes: "Done."}, "admin_2", later)
	if err != nil || changed || got != first {
		t.Errorf("Resolve = %+v, changed %v, err %v; want the first resolution unchanged", got, changed, err)
	}
}

func TestRequestSupport(t *testing.T) {
	ownedConflict := Subscription{OwnerID: "user_1", Conflict: true}
	existing := Support{Message: "I was charged twice.", At: discovered}

	cases := []struct {
		name        string
		sub         Subscription
		requester   string
		message     string
		want        Support
		wantCreated bool
		wantErr     error
	}{
		{
			name:        "the owner's first message is recorded with its time",
			sub:         ownedConflict,
			requester:   "user_1",
			message:     "  I was charged twice.\n",
			want:        Support{Message: "I was charged twice.", At: resolvedAt},
			wantCreated: true,
		},
		{
			name:      "a repeated click returns the first request and raises nothing new",
			sub:       Subscription{OwnerID: "user_1", Conflict: true, Support: existing},
			requester: "user_1",
			message:   "I was charged twice.",
			want:      existing,
		},
		{
			name:      "a different later message still returns the first request",
			sub:       Subscription{OwnerID: "user_1", Conflict: true, Support: existing},
			requester: "user_1",
			message:   "Hello again?",
			want:      existing,
		},
		{
			name:      "another user's conflict is refused",
			sub:       ownedConflict,
			requester: "user_2",
			message:   "Not mine.",
			wantErr:   ErrNotOwnedConflict,
		},
		{
			name:      "a subscription that is not a conflict is refused",
			sub:       Subscription{OwnerID: "user_1"},
			requester: "user_1",
			message:   "Help.",
			wantErr:   ErrNotOwnedConflict,
		},
		{
			name:      "an unattributed subscription is refused",
			sub:       Subscription{Conflict: true},
			requester: "",
			message:   "Help.",
			wantErr:   ErrNotOwnedConflict,
		},
		{
			name:      "a blank message is refused",
			sub:       ownedConflict,
			requester: "user_1",
			message:   " \n\t",
			wantErr:   ErrBlankMessage,
		},
		{
			name:        "a message of exactly the limit in characters is taken",
			sub:         ownedConflict,
			requester:   "user_1",
			message:     strings.Repeat("退", MaxSupportMessageLength),
			want:        Support{Message: strings.Repeat("退", MaxSupportMessageLength), At: resolvedAt},
			wantCreated: true,
		},
		{
			name:      "a message over the limit is refused",
			sub:       ownedConflict,
			requester: "user_1",
			message:   strings.Repeat("a", MaxSupportMessageLength+1),
			wantErr:   ErrMessageTooLong,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, created, err := RequestSupport(tc.sub, tc.requester, tc.message, resolvedAt)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if got != tc.want || created != tc.wantCreated {
				t.Errorf("RequestSupport = %+v, created %v; want %+v, created %v", got, created, tc.want, tc.wantCreated)
			}
		})
	}
}

func TestParseListQuery(t *testing.T) {
	cases := []struct {
		name    string
		status  string
		limit   int
		offset  int
		want    ListQuery
		wantErr error
	}{
		{name: "defaults list every conflict, 50 at a time from the newest", want: ListQuery{Limit: DefaultListLimit}},
		{name: "open only", status: "open", limit: 10, offset: 20, want: ListQuery{Status: Open, Limit: 10, Offset: 20}},
		{name: "resolved only", status: "resolved", want: ListQuery{Status: Resolved, Limit: DefaultListLimit}},
		{name: "the limit is capped", limit: 1000, want: ListQuery{Limit: MaxListLimit}},
		{name: "a negative limit takes the default", limit: -1, want: ListQuery{Limit: DefaultListLimit}},
		{name: "a negative offset starts at the newest", offset: -5, want: ListQuery{Limit: DefaultListLimit}},
		{name: "an unknown status is refused", status: "closed", wantErr: ErrInvalidStatus},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseListQuery(tc.status, tc.limit, tc.offset)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if got != tc.want {
				t.Errorf("ParseListQuery = %+v, want %+v", got, tc.want)
			}
		})
	}
}
