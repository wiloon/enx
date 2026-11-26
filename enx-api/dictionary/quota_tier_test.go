package dictionary

import (
	"context"
	"errors"
	"testing"
)

// fakeTierSource answers the tier rule's two reads and counts the balance
// reads.
type fakeTierSource struct {
	subscribed   bool
	subErr       error
	topup        int64
	topupErr     error
	balanceReads int
}

func (f *fakeTierSource) IsActiveSubscriber(context.Context, string) (bool, error) {
	return f.subscribed, f.subErr
}

func (f *fakeTierSource) TopupBalance(context.Context, string) (int64, error) {
	f.balanceReads++
	return f.topup, f.topupErr
}

// ADR-093: the paid tier is an active subscription or a top-up balance above
// 0, and a failed read leaves the tier unknown.
func TestQuotaTierOf(t *testing.T) {
	dbDown := errors.New("db down")
	for _, tc := range []struct {
		name             string
		source           fakeTierSource
		want             QuotaTier
		wantErr          error
		wantBalanceReads int
	}{
		{"subscription only", fakeTierSource{subscribed: true}, TierPaid, nil, 0},
		{"top-up balance only", fakeTierSource{topup: 1}, TierPaid, nil, 1},
		{"both", fakeTierSource{subscribed: true, topup: 1}, TierPaid, nil, 0},
		{"neither, top-up balance 0", fakeTierSource{}, TierFree, nil, 1},
		{"negative top-up balance", fakeTierSource{topup: -1}, TierFree, nil, 1},
		{"subscription read fails", fakeTierSource{subErr: dbDown, topup: 1}, TierUnknown, dbDown, 0},
		{"balance read fails", fakeTierSource{topupErr: dbDown}, TierUnknown, dbDown, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := tc.source

			got, err := QuotaTierOf(context.Background(), &source, "u1")

			if got != tc.want || !errors.Is(err, tc.wantErr) {
				t.Errorf("got tier %v, error %v; want %v, %v", got, err, tc.want, tc.wantErr)
			}
			if source.balanceReads != tc.wantBalanceReads {
				t.Errorf("balance reads = %d, want %d", source.balanceReads, tc.wantBalanceReads)
			}
		})
	}
}
