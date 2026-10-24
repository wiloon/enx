package acceptance

import "testing"

func TestDecide(t *testing.T) {
	cases := []struct {
		name string
		obs  Observation
		want Decision
	}{
		{
			name: "a first live subscription is accepted",
			obs:  Observation{IncomingID: "sub_b", IncomingStatus: "active"},
			want: Decision{Outcome: Accept},
		},
		{
			name: "an incomplete first checkout is still accepted: Stripe can bill it",
			obs:  Observation{IncomingID: "sub_b", IncomingStatus: "incomplete"},
			want: Decision{Outcome: Accept},
		},
		{
			name: "the accepted subscription replayed is not a conflict",
			obs:  Observation{IncomingID: "sub_a", IncomingClassification: Accepted, IncomingStatus: "active", AcceptedID: "sub_a", AcceptedStatus: "active"},
			want: Decision{Outcome: Replay},
		},
		{
			name: "the accepted subscription replayed after it ended is still a replay",
			obs:  Observation{IncomingID: "sub_a", IncomingClassification: Accepted, IncomingStatus: "canceled", AcceptedID: "sub_a", AcceptedStatus: "canceled"},
			want: Decision{Outcome: Replay},
		},
		{
			name: "a second live subscription competing with a live accepted one is a conflict",
			obs:  Observation{IncomingID: "sub_b", IncomingStatus: "active", AcceptedID: "sub_a", AcceptedStatus: "active"},
			want: Decision{Outcome: MarkConflict, Reason: ReasonCompetesWithAccepted, ConflictWith: "sub_a"},
		},
		{
			name: "an unpaid accepted subscription still competes",
			obs:  Observation{IncomingID: "sub_b", IncomingStatus: "active", AcceptedID: "sub_a", AcceptedStatus: "unpaid"},
			want: Decision{Outcome: MarkConflict, Reason: ReasonCompetesWithAccepted, ConflictWith: "sub_a"},
		},
		{
			name: "a past-due accepted subscription still competes",
			obs:  Observation{IncomingID: "sub_b", IncomingStatus: "active", AcceptedID: "sub_a", AcceptedStatus: "past_due"},
			want: Decision{Outcome: MarkConflict, Reason: ReasonCompetesWithAccepted, ConflictWith: "sub_a"},
		},
		{
			name: "a normal replacement after the accepted subscription was canceled",
			obs:  Observation{IncomingID: "sub_b", IncomingStatus: "active", AcceptedID: "sub_a", AcceptedStatus: "canceled"},
			want: Decision{Outcome: Accept},
		},
		{
			name: "a normal replacement after the accepted checkout expired",
			obs:  Observation{IncomingID: "sub_b", IncomingStatus: "active", AcceptedID: "sub_a", AcceptedStatus: "incomplete_expired"},
			want: Decision{Outcome: Accept},
		},
		{
			name: "an unclassified subscription that already ended is stale, whatever is accepted",
			obs:  Observation{IncomingID: "sub_b", IncomingStatus: "canceled", AcceptedID: "sub_a", AcceptedStatus: "active"},
			want: Decision{Outcome: MarkStale},
		},
		{
			name: "an expired first checkout is stale",
			obs:  Observation{IncomingID: "sub_b", IncomingStatus: "incomplete_expired"},
			want: Decision{Outcome: MarkStale},
		},
		{
			name: "a conflict is never promoted, even after the accepted subscription ends",
			obs:  Observation{IncomingID: "sub_b", IncomingClassification: Conflict, IncomingStatus: "active", AcceptedID: "sub_a", AcceptedStatus: "canceled"},
			want: Decision{Outcome: Unchanged},
		},
		{
			name: "a conflict is never promoted when nothing is accepted",
			obs:  Observation{IncomingID: "sub_b", IncomingClassification: Conflict, IncomingStatus: "active"},
			want: Decision{Outcome: Unchanged},
		},
		{
			name: "a formerly accepted subscription stays history after its replacement",
			obs:  Observation{IncomingID: "sub_a", IncomingClassification: Accepted, IncomingStatus: "active", AcceptedID: "sub_b", AcceptedStatus: "active"},
			want: Decision{Outcome: Unchanged},
		},
		{
			name: "a stale subscription stays stale",
			obs:  Observation{IncomingID: "sub_b", IncomingClassification: Stale, IncomingStatus: "active"},
			want: Decision{Outcome: Unchanged},
		},
		{
			name: "nothing is accepted while the account is being deleted",
			obs:  Observation{IncomingID: "sub_b", IncomingStatus: "active", Deletion: DeletionInProgress},
			want: Decision{Outcome: WaitForDeletion},
		},
		{
			name: "a subscription paid after account deletion needs attention",
			obs:  Observation{IncomingID: "sub_b", IncomingStatus: "active", Deletion: DeletionCompleted},
			want: Decision{Outcome: NeedsAttention, Reason: ReasonPaymentAfterAccountDeletion},
		},
		{
			name: "a replay during deletion changes nothing",
			obs:  Observation{IncomingID: "sub_a", IncomingClassification: Accepted, IncomingStatus: "active", AcceptedID: "sub_a", AcceptedStatus: "active", Deletion: DeletionInProgress},
			want: Decision{Outcome: Replay},
		},
		{
			name: "an incoming status outside Stripe's known lifecycle needs attention",
			obs:  Observation{IncomingID: "sub_b", IncomingStatus: "paused"},
			want: Decision{Outcome: NeedsAttention, Reason: ReasonUnrecognizedStatus},
		},
		{
			name: "an accepted status outside Stripe's known lifecycle needs attention",
			obs:  Observation{IncomingID: "sub_b", IncomingStatus: "active", AcceptedID: "sub_a", AcceptedStatus: ""},
			want: Decision{Outcome: NeedsAttention, Reason: ReasonUnrecognizedStatus},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Decide(tc.obs); got != tc.want {
				t.Errorf("Decide(%+v) = %+v, want %+v", tc.obs, got, tc.want)
			}
		})
	}
}

func TestBillableAndEnded(t *testing.T) {
	billable := []string{"active", "trialing", "past_due", "incomplete", "unpaid"}
	ended := []string{"canceled", "incomplete_expired"}
	neither := []string{"paused", "", "unknown"}
	for _, s := range billable {
		if !Billable(s) || Ended(s) {
			t.Errorf("%q: Billable = %v, Ended = %v; want true, false", s, Billable(s), Ended(s))
		}
	}
	for _, s := range ended {
		if Billable(s) || !Ended(s) {
			t.Errorf("%q: Billable = %v, Ended = %v; want false, true", s, Billable(s), Ended(s))
		}
	}
	for _, s := range neither {
		if Billable(s) || Ended(s) {
			t.Errorf("%q: Billable = %v, Ended = %v; want false, false", s, Billable(s), Ended(s))
		}
	}
}
