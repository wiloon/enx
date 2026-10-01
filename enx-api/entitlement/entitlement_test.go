package entitlement

import (
	"context"
	"errors"
	"testing"
)

type fakeSource struct {
	subscribed    bool
	topup         int64
	subscribedErr error
	topupErr      error
	topupReads    int
}

func (f *fakeSource) IsActiveSubscriber(context.Context, string) (bool, error) {
	return f.subscribed, f.subscribedErr
}

func (f *fakeSource) TopupBalance(context.Context, string) (int64, error) {
	f.topupReads++
	return f.topup, f.topupErr
}

func TestStatus(t *testing.T) {
	for _, tc := range []struct {
		name string
		src  fakeSource
		want Status
	}{
		{"subscriber with no top-up", fakeSource{subscribed: true}, Status{Subscribed: true, CanUseAI: true}},
		{"subscriber with top-up", fakeSource{subscribed: true, topup: 50}, Status{Subscribed: true, CanUseAI: true}},
		{"top-up only", fakeSource{topup: 50}, Status{CanUseAI: true}},
		{"neither", fakeSource{}, Status{}},
		{"overdrawn top-up and no subscription", fakeSource{topup: -3}, Status{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			src := tc.src
			got, err := NewService(&src).Status(context.Background(), "u1")
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("Status = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestStatusSkipsTopupReadForSubscribers(t *testing.T) {
	src := &fakeSource{subscribed: true}
	if _, err := NewService(src).Status(context.Background(), "u1"); err != nil {
		t.Fatal(err)
	}
	if src.topupReads != 0 {
		t.Fatalf("top-up read %d times for a subscriber, want 0", src.topupReads)
	}
}

func TestStatusReturnsSourceErrors(t *testing.T) {
	boom := errors.New("db down")
	for name, src := range map[string]*fakeSource{
		"subscription read fails": {subscribedErr: boom},
		"top-up read fails":       {topupErr: boom},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := NewService(src).Status(context.Background(), "u1"); !errors.Is(err, boom) {
				t.Fatalf("err = %v, want the source error", err)
			}
		})
	}
}
