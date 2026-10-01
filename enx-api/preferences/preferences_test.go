package preferences

import (
	"context"
	"errors"
	"testing"

	"enx-api/entitlement"
)

type fakeStore struct {
	values map[Key]bool
	err    error
}

func newFakeStore() *fakeStore { return &fakeStore{values: map[Key]bool{}} }

func (f *fakeStore) Load(context.Context, string) (map[Key]bool, error) {
	out := make(map[Key]bool, len(f.values))
	for k, v := range f.values {
		out[k] = v
	}
	return out, f.err
}

func (f *fakeStore) Save(_ context.Context, _ string, key Key, value bool) error {
	if f.err != nil {
		return f.err
	}
	f.values[key] = value
	return nil
}

func (f *fakeStore) Clear(_ context.Context, _ string, key Key) error {
	if f.err != nil {
		return f.err
	}
	delete(f.values, key)
	return nil
}

type fakeEnt struct {
	status entitlement.Status
	err    error
}

func (f fakeEnt) Status(context.Context, string) (entitlement.Status, error) { return f.status, f.err }

var (
	subscriber = entitlement.Status{Subscribed: true, CanUseAI: true}
	topupOnly  = entitlement.Status{CanUseAI: true}
	free       = entitlement.Status{}
)

func ptr(b bool) *bool { return &b }

func get(t *testing.T, store *fakeStore, status entitlement.Status, key Key) View {
	t.Helper()
	views, err := NewService(store, fakeEnt{status: status}).Get(context.Background(), "u1")
	if err != nil {
		t.Fatal(err)
	}
	return views[key]
}

func TestAIWordFallbackDefaults(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status entitlement.Status
		want   View
	}{
		{"subscriber is on and may change it", subscriber, View{Effective: true, Editable: true}},
		{"top-up-only user may use AI but starts off", topupOnly, View{Effective: false, Editable: true}},
		{"free user is off and cannot change it", free, View{Effective: false, Editable: false}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := get(t, newFakeStore(), tc.status, AIWordFallback); got != tc.want {
				t.Fatalf("view = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestAIWordFallbackExplicitChoice(t *testing.T) {
	for _, tc := range []struct {
		name     string
		status   entitlement.Status
		explicit bool
		want     bool
	}{
		{"subscriber turns it off", subscriber, false, false},
		{"top-up-only user turns it on", topupOnly, true, true},
		// The lapse case: the stored choice survives, but the server stops
		// acting on it until the user is entitled again.
		{"lapsed user's stored on is not effective", free, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore()
			store.values[AIWordFallback] = tc.explicit
			got := get(t, store, tc.status, AIWordFallback)
			if got.Effective != tc.want {
				t.Fatalf("Effective = %v, want %v", got.Effective, tc.want)
			}
			if got.Value == nil || *got.Value != tc.explicit {
				t.Fatalf("Value = %v, want the stored %v kept", got.Value, tc.explicit)
			}
		})
	}
}

func TestNoticeAckIsNotTiedToPayment(t *testing.T) {
	for _, status := range []entitlement.Status{subscriber, topupOnly, free} {
		got := get(t, newFakeStore(), status, AIWordFallbackNoticeAck)
		if got.Effective || !got.Editable {
			t.Fatalf("status %+v: view = %+v, want unset, effective false, editable", status, got)
		}
	}
	store := newFakeStore()
	store.values[AIWordFallbackNoticeAck] = true
	if got := get(t, store, free, AIWordFallbackNoticeAck); !got.Effective {
		t.Fatal("a free user's acknowledged notice should be effective")
	}
}

func TestUpdateStoresAndClears(t *testing.T) {
	store := newFakeStore()
	svc := NewService(store, fakeEnt{status: subscriber})
	ctx := context.Background()

	if err := svc.Update(ctx, "u1", map[string]*bool{"aiWordFallback": ptr(false)}); err != nil {
		t.Fatal(err)
	}
	if v, ok := store.values[AIWordFallback]; !ok || v {
		t.Fatalf("stored = %v/%v, want an explicit false", v, ok)
	}
	if err := svc.Update(ctx, "u1", map[string]*bool{"aiWordFallback": nil}); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.values[AIWordFallback]; ok {
		t.Fatal("a null change should clear the stored value")
	}
}

func TestUpdateLeavesUntouchedKeysAlone(t *testing.T) {
	store := newFakeStore()
	store.values[AIWordFallback] = false
	svc := NewService(store, fakeEnt{status: subscriber})
	if err := svc.Update(context.Background(), "u1", map[string]*bool{"aiWordFallbackNoticeAck": ptr(true)}); err != nil {
		t.Fatal(err)
	}
	if v, ok := store.values[AIWordFallback]; !ok || v {
		t.Fatal("a key absent from the request must not change")
	}
}

func TestUpdateRejections(t *testing.T) {
	for _, tc := range []struct {
		name    string
		status  entitlement.Status
		changes map[string]*bool
		want    error
	}{
		{"unknown key", subscriber, map[string]*bool{"nope": ptr(true)}, ErrUnknownKey},
		{"free user cannot change the AI fallback", free, map[string]*bool{"aiWordFallback": ptr(true)}, ErrNotEditable},
		{"free user cannot clear it either", free, map[string]*bool{"aiWordFallback": nil}, ErrNotEditable},
		{
			// Validation happens before any write: the editable key in the
			// same request must not be applied.
			"one bad key rejects the whole request", free,
			map[string]*bool{"aiWordFallbackNoticeAck": ptr(true), "aiWordFallback": ptr(true)}, ErrNotEditable,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore()
			err := NewService(store, fakeEnt{status: tc.status}).Update(context.Background(), "u1", tc.changes)
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if len(store.values) != 0 {
				t.Fatalf("a rejected update wrote %v", store.values)
			}
		})
	}
}

func TestEffective(t *testing.T) {
	ctx := context.Background()
	svc := NewService(newFakeStore(), fakeEnt{status: subscriber})
	if on, err := svc.Effective(ctx, "u1", AIWordFallback); err != nil || !on {
		t.Fatalf("Effective = %v, %v, want true for a subscriber", on, err)
	}
	if _, err := svc.Effective(ctx, "u1", Key("nope")); !errors.Is(err, ErrUnknownKey) {
		t.Fatalf("err = %v, want ErrUnknownKey", err)
	}
}

func TestErrorsFromDependenciesSurface(t *testing.T) {
	boom := errors.New("db down")
	ctx := context.Background()
	if _, err := NewService(newFakeStore(), fakeEnt{err: boom}).Get(ctx, "u1"); !errors.Is(err, boom) {
		t.Fatalf("entitlement error: err = %v", err)
	}
	failing := newFakeStore()
	failing.err = boom
	if _, err := NewService(failing, fakeEnt{status: subscriber}).Get(ctx, "u1"); !errors.Is(err, boom) {
		t.Fatalf("store error on Get: err = %v", err)
	}
	if err := NewService(failing, fakeEnt{status: subscriber}).Update(ctx, "u1", map[string]*bool{"aiWordFallback": ptr(true)}); !errors.Is(err, boom) {
		t.Fatalf("store error on Update: err = %v", err)
	}
}
