package preferences

import (
	"context"
	"errors"
	"testing"

	"enx-api/entitlement"
)

type fakeStore struct {
	values map[Key]any
	err    error
}

func newFakeStore() *fakeStore { return &fakeStore{values: map[Key]any{}} }

func (f *fakeStore) Load(context.Context, string) (map[Key]any, error) {
	out := make(map[Key]any, len(f.values))
	for k, v := range f.values {
		out[k] = v
	}
	return out, f.err
}

func (f *fakeStore) Save(_ context.Context, _ string, key Key, value any) error {
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
			if got.Value != tc.explicit {
				t.Fatalf("Value = %v, want the stored %v kept", got.Value, tc.explicit)
			}
		})
	}
}

func TestNoticeAckIsNotTiedToPayment(t *testing.T) {
	for _, status := range []entitlement.Status{subscriber, topupOnly, free} {
		got := get(t, newFakeStore(), status, AIWordFallbackNoticeAck)
		if got.Effective != false || !got.Editable {
			t.Fatalf("status %+v: view = %+v, want unset, effective false, editable", status, got)
		}
	}
	store := newFakeStore()
	store.values[AIWordFallbackNoticeAck] = true
	if got := get(t, store, free, AIWordFallbackNoticeAck); got.Effective != true {
		t.Fatal("a free user's acknowledged notice should be effective")
	}
}

func TestOnboardingCompletedDefaultsOffAndIsWritable(t *testing.T) {
	for _, status := range []entitlement.Status{subscriber, topupOnly, free} {
		got := get(t, newFakeStore(), status, OnboardingCompleted)
		if got.Value != nil || got.Effective != false || !got.Editable {
			t.Fatalf("status %+v: view = %+v, want unset, effective false, writable", status, got)
		}
	}
	store := newFakeStore()
	svc := NewService(store, fakeEnt{status: free})
	if err := svc.Update(context.Background(), "u1", map[string]any{"onboardingCompleted": true}); err != nil {
		t.Fatal(err)
	}
	if got := get(t, store, free, OnboardingCompleted); got.Effective != true {
		t.Fatal("a free user's completed onboarding should be effective")
	}
}

func TestUpdateStoresAndClears(t *testing.T) {
	store := newFakeStore()
	svc := NewService(store, fakeEnt{status: subscriber})
	ctx := context.Background()

	if err := svc.Update(ctx, "u1", map[string]any{"aiWordFallback": false}); err != nil {
		t.Fatal(err)
	}
	if v, ok := store.values[AIWordFallback]; !ok || v != false {
		t.Fatalf("stored = %v/%v, want an explicit false", v, ok)
	}
	if err := svc.Update(ctx, "u1", map[string]any{"aiWordFallback": nil}); err != nil {
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
	if err := svc.Update(context.Background(), "u1", map[string]any{"aiWordFallbackNoticeAck": true}); err != nil {
		t.Fatal(err)
	}
	if v, ok := store.values[AIWordFallback]; !ok || v != false {
		t.Fatal("a key absent from the request must not change")
	}
}

func TestUpdateRejections(t *testing.T) {
	for _, tc := range []struct {
		name    string
		status  entitlement.Status
		changes map[string]any
		want    error
	}{
		{"unknown key", subscriber, map[string]any{"nope": true}, ErrUnknownKey},
		{"free user cannot change the AI fallback", free, map[string]any{"aiWordFallback": true}, ErrNotEditable},
		{"free user cannot clear it either", free, map[string]any{"aiWordFallback": nil}, ErrNotEditable},
		{
			// Validation happens before any write: the editable key in the
			// same request must not be applied.
			"one bad key rejects the whole request", free,
			map[string]any{"aiWordFallbackNoticeAck": true, "aiWordFallback": true}, ErrNotEditable,
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
	if err := NewService(failing, fakeEnt{status: subscriber}).Update(ctx, "u1", map[string]any{"aiWordFallback": true}); !errors.Is(err, boom) {
		t.Fatalf("store error on Update: err = %v", err)
	}
}

func TestExplanationLanguageDefaultsToChineseForEveryone(t *testing.T) {
	for _, status := range []entitlement.Status{subscriber, topupOnly, free} {
		got := get(t, newFakeStore(), status, ExplanationLanguage)
		want := View{Effective: "zh-Hans", Editable: true}
		if got != want {
			t.Fatalf("status %+v: view = %+v, want %+v", status, got, want)
		}
	}
}

func TestExplanationLanguageIsStoredReadBackAndCleared(t *testing.T) {
	store := newFakeStore()
	svc := NewService(store, fakeEnt{status: free})
	ctx := context.Background()

	if err := svc.Update(ctx, "u1", map[string]any{"explanationLanguage": "en"}); err != nil {
		t.Fatal(err)
	}
	if got := get(t, store, free, ExplanationLanguage); got.Value != "en" || got.Effective != "en" {
		t.Fatalf("view = %+v, want en stored and effective", got)
	}
	if err := svc.Update(ctx, "u1", map[string]any{"explanationLanguage": nil}); err != nil {
		t.Fatal(err)
	}
	if got := get(t, store, free, ExplanationLanguage); got.Value != nil || got.Effective != "zh-Hans" {
		t.Fatalf("view after null = %+v, want the default", got)
	}
}

func TestUpdateRejectsInvalidValuesAndWritesNothing(t *testing.T) {
	for _, tc := range []struct {
		name    string
		changes map[string]any
		want    error
	}{
		{"a language not on the list", map[string]any{"explanationLanguage": "zh-Hant"}, ErrInvalidValue},
		{"a boolean for the enum key", map[string]any{"explanationLanguage": true}, ErrInvalidValue},
		{"a string for a boolean key", map[string]any{"aiWordFallback": "en"}, ErrInvalidValue},
		{"a number for a boolean key", map[string]any{"onboardingCompleted": float64(1)}, ErrInvalidValue},
		{"an unknown key whatever its value", map[string]any{"nope": "en"}, ErrUnknownKey},
		{
			"one bad value rejects the other keys too",
			map[string]any{"onboardingCompleted": true, "aiWordFallback": true, "explanationLanguage": "fr"},
			ErrInvalidValue,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Map order is random, so repeat: a write before the bad key is
			// checked would show up in one of the runs.
			for range 20 {
				store := newFakeStore()
				err := NewService(store, fakeEnt{status: subscriber}).Update(context.Background(), "u1", tc.changes)
				if !errors.Is(err, tc.want) {
					t.Fatalf("err = %v, want %v", err, tc.want)
				}
				if len(store.values) != 0 {
					t.Fatalf("a rejected update wrote %v", store.values)
				}
			}
		})
	}
}

func TestAnInvalidValueIsReportedBeforeEditability(t *testing.T) {
	err := NewService(newFakeStore(), fakeEnt{status: free}).
		Update(context.Background(), "u1", map[string]any{"aiWordFallback": "yes"})
	if !errors.Is(err, ErrInvalidValue) {
		t.Fatalf("err = %v, want ErrInvalidValue", err)
	}
}

func TestStoredValueNoLongerAllowedReadsAsUnset(t *testing.T) {
	for _, tc := range []struct {
		name   string
		key    Key
		stored any
		want   View
	}{
		{"a language no longer allowed", ExplanationLanguage, "fr", View{Effective: "zh-Hans", Editable: true}},
		{"a boolean under the enum key", ExplanationLanguage, true, View{Effective: "zh-Hans", Editable: true}},
		{"a string under a boolean key", AIWordFallback, "yes", View{Effective: true, Editable: true}},
		{"a JSON null row", OnboardingCompleted, nil, View{Effective: false, Editable: true}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore()
			store.values[tc.key] = tc.stored
			if got := get(t, store, subscriber, tc.key); got != tc.want {
				t.Fatalf("view = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestEffectiveRefusesAnEnumKey(t *testing.T) {
	svc := NewService(newFakeStore(), fakeEnt{status: subscriber})
	if on, err := svc.Effective(context.Background(), "u1", ExplanationLanguage); err == nil {
		t.Fatalf("Effective = %v with no error, want an error for a non-boolean key", on)
	}
}
