package attribution

import "testing"

func TestAttribute(t *testing.T) {
	cases := []struct {
		name string
		e    Evidence
		want Result
	}{
		{
			name: "subscription metadata alone attributes the subscription",
			e:    Evidence{MetadataUserID: "u1"},
			want: Result{Outcome: Attributed, UserID: "u1"},
		},
		{
			name: "a legacy subscription without metadata is attributed by its checkout",
			e:    Evidence{CheckoutUserID: "u1"},
			want: Result{Outcome: Attributed, UserID: "u1"},
		},
		{
			name: "a stored owner attributes later events that carry no user",
			e:    Evidence{OwnerUserID: "u1"},
			want: Result{Outcome: Attributed, UserID: "u1"},
		},
		{
			name: "every source agreeing attributes the subscription",
			e:    Evidence{MetadataUserID: "u1", CheckoutUserID: "u1", OwnerUserID: "u1"},
			want: Result{Outcome: Attributed, UserID: "u1"},
		},
		{
			name: "an invoice before its checkout waits rather than counting as a competing subscription",
			e:    Evidence{},
			want: Result{Outcome: Missing, Reason: ReasonAttributionMissing},
		},
		{
			name: "metadata and checkout naming different users need attention",
			e:    Evidence{MetadataUserID: "u1", CheckoutUserID: "u2"},
			want: Result{Outcome: Contradictory, Reason: ReasonContradictoryUserIdentity},
		},
		{
			name: "metadata never overwrites a stored owner",
			e:    Evidence{MetadataUserID: "u2", OwnerUserID: "u1"},
			want: Result{Outcome: Contradictory, Reason: ReasonContradictoryUserIdentity},
		},
		{
			name: "a checkout never overwrites a stored owner",
			e:    Evidence{CheckoutUserID: "u2", OwnerUserID: "u1"},
			want: Result{Outcome: Contradictory, Reason: ReasonContradictoryUserIdentity},
		},
		{
			name: "two sources agreeing do not outvote a third",
			e:    Evidence{MetadataUserID: "u1", CheckoutUserID: "u1", OwnerUserID: "u2"},
			want: Result{Outcome: Contradictory, Reason: ReasonContradictoryUserIdentity},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Attribute(c.e); got != c.want {
				t.Errorf("Attribute(%+v) = %+v, want %+v", c.e, got, c.want)
			}
		})
	}
}
