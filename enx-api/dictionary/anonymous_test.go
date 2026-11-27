package dictionary

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	deviceA = "0b5f7c1e-4d0a-4f7e-9b2a-6c1d2e3f4a5b"
	deviceB = "1c6a8d2f-5e1b-4a8f-8c3b-7d2e3f4a5b6c"
)

// anonResolver answers every word with res (or err) and records the userID
// of every call.
type anonResolver struct {
	mu    sync.Mutex
	res   Result
	err   error
	users []string
}

func (f *anonResolver) Resolve(_ context.Context, english, userID string) (Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.users = append(f.users, userID)
	res := f.res
	if res.English == "" {
		res.English = english
	}
	return res, f.err
}

func (f *anonResolver) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.users)
}

// fakeDevices is an in-memory DeviceUsageStore keyed by hash and UTC day.
type fakeDevices struct {
	mu     sync.Mutex
	used   map[string]int64
	hashes []string
	err    error
}

func newFakeDevices() *fakeDevices { return &fakeDevices{used: map[string]int64{}} }

func (f *fakeDevices) Take(_ context.Context, hash string, day time.Time, limit int64) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hashes = append(f.hashes, hash)
	if f.err != nil {
		return false, f.err
	}
	key := hash + "/" + day.UTC().Format("2006-01-02")
	if f.used[key] >= limit {
		return false, nil
	}
	f.used[key]++
	return true, nil
}

func (f *fakeDevices) takes() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.hashes)
}

// fakeRate allows every request unless refuse is set, and records the keys.
type fakeRate struct {
	mu     sync.Mutex
	refuse bool
	keys   []string
}

func (f *fakeRate) Allow(key string) (bool, time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.keys = append(f.keys, key)
	if f.refuse {
		return false, 7 * time.Second
	}
	return true, 0
}

// fakeAnonObserver counts every outcome.
type fakeAnonObserver struct {
	mu      sync.Mutex
	allowed int
	refused map[AnonymousLayer]int
}

func (f *fakeAnonObserver) ObserveAnonymousLookupAllowed() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.allowed++
}

func (f *fakeAnonObserver) ObserveAnonymousLookupRefused(layer string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.refused == nil {
		f.refused = map[AnonymousLayer]int{}
	}
	f.refused[AnonymousLayer(layer)]++
}

type anonFixture struct {
	svc      *AnonymousLookups
	resolver *anonResolver
	devices  *fakeDevices
	rate     *fakeRate
	obs      *fakeAnonObserver
	now      time.Time
}

// 2026-11-26 23:00 UTC: an hour before the limits reset.
var anonNow = time.Date(2026, 11, 26, 23, 0, 0, 0, time.UTC)

func newAnonFixture(limits AnonymousLimits) *anonFixture {
	f := &anonFixture{
		resolver: &anonResolver{res: Result{ID: "w1", Chinese: "v. 跑", Source: SourceLocal, Origin: OriginECDICT}},
		devices:  newFakeDevices(),
		rate:     &fakeRate{},
		obs:      &fakeAnonObserver{},
		now:      anonNow,
	}
	f.svc = NewAnonymousLookups(f.resolver, f.rate, NewMemoryIPDailyCounter(), f.devices, limits,
		func() time.Time { return f.now }).WithObserver(f.obs)
	return f
}

func limits(device, ip int64) AnonymousLimits {
	return AnonymousLimits{Enabled: true, DeviceDaily: device, IPDaily: ip}
}

func (f *anonFixture) lookup(device, ip, word string) (EntryResult, error) {
	return f.svc.Lookup(context.Background(), AnonymousRequest{DeviceID: device, ClientIP: ip, Word: word})
}

func refusalOf(t *testing.T, err error) *AnonymousRefusal {
	t.Helper()
	var r *AnonymousRefusal
	if !errors.As(err, &r) {
		t.Fatalf("err = %v, want an *AnonymousRefusal", err)
	}
	return r
}

func TestAnonymousLookupResolvesForNoUser(t *testing.T) {
	f := newAnonFixture(limits(100, 1000))

	got, err := f.lookup(deviceA, "203.0.113.7", "Running.")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != EntryFound || got.Word != "Running" || got.Result.Chinese != "v. 跑" || got.AIFallback != nil {
		t.Fatalf("got %+v, want found with no AI fallback", got)
	}
	if len(f.resolver.users) != 1 || f.resolver.users[0] != NoUser {
		t.Fatalf("resolved for %q, want once for NoUser", f.resolver.users)
	}
	if f.obs.allowed != 1 {
		t.Fatalf("allowed observed %d times, want 1", f.obs.allowed)
	}
}

func TestAnonymousLookupStatuses(t *testing.T) {
	for _, tc := range []struct {
		name string
		res  Result
		err  error
		want EntryStatus
	}{
		{"miss", Result{Source: SourceMiss}, nil, EntryNotFound},
		{"ECDICT unavailable", Result{}, ErrEcdictUnavailable, EntryFailed},
		{"timeout", Result{Source: SourceTimeout}, nil, EntryFailed},
		{"store error", Result{}, errors.New("disk I/O"), EntryFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newAnonFixture(limits(100, 1000))
			f.resolver.res, f.resolver.err = tc.res, tc.err
			got, err := f.lookup(deviceA, "203.0.113.7", "zzxqv")
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != tc.want || got.AIFallback != nil {
				t.Fatalf("got %+v, want status %s and no AI fallback", got, tc.want)
			}
		})
	}
}

func TestAnonymousLookupSwitchedOff(t *testing.T) {
	f := newAnonFixture(AnonymousLimits{Enabled: false, DeviceDaily: 100, IPDaily: 1000})
	if f.svc.Enabled() {
		t.Fatal("Enabled() = true with the switch off")
	}
	if _, err := f.lookup(deviceA, "203.0.113.7", "run"); !errors.Is(err, ErrAnonymousLookupDisabled) {
		t.Fatalf("err = %v, want ErrAnonymousLookupDisabled", err)
	}
	if f.resolver.calls() != 0 || f.devices.takes() != 0 || len(f.rate.keys) != 0 {
		t.Fatal("a switched-off lookup must reach no limit and no dictionary")
	}
}

func TestAnonymousLookupRejectsInvalidRequestsWithoutCounting(t *testing.T) {
	f := newAnonFixture(limits(1, 1))
	for _, tc := range []struct {
		name, device, word string
		want               error
	}{
		{"no device id", "", "run", ErrInvalidDeviceID},
		{"device id not a UUID", "not-a-uuid", "run", ErrInvalidDeviceID},
		{"device id in braces", "{" + deviceA + "}", "run", ErrInvalidDeviceID},
		{"word with a space", deviceA, "good morning", ErrInvalidAnonymousWord},
		{"word with no letters", deviceA, "123", ErrInvalidAnonymousWord},
		{"word of 65 characters", deviceA, strings.Repeat("a", 65), ErrInvalidAnonymousWord},
		{"empty word", deviceA, "", ErrInvalidAnonymousWord},
	} {
		if _, err := f.lookup(tc.device, "203.0.113.7", tc.word); !errors.Is(err, tc.want) {
			t.Errorf("%s: err = %v, want %v", tc.name, err, tc.want)
		}
	}
	if f.resolver.calls() != 0 || f.devices.takes() != 0 || len(f.rate.keys) != 0 {
		t.Fatal("an invalid request must reach no limit and no dictionary")
	}
	// Nothing was counted: a limit of one still serves one.
	if _, err := f.lookup(deviceA, "203.0.113.7", strings.Repeat("a", 64)); err != nil {
		t.Fatalf("a 64-character word after only invalid requests: %v", err)
	}
}

func TestAnonymousLookupStoresOnlyTheDeviceIDHash(t *testing.T) {
	f := newAnonFixture(limits(100, 1000))
	if _, err := f.lookup(strings.ToUpper(deviceA), "203.0.113.7", "run"); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(deviceA))
	if want := hex.EncodeToString(sum[:]); len(f.devices.hashes) != 1 || f.devices.hashes[0] != want {
		t.Fatalf("store saw %v, want the SHA-256 of the lowercase id %s", f.devices.hashes, want)
	}
}

func TestAnonymousLookupDeviceDailyLimit(t *testing.T) {
	f := newAnonFixture(limits(100, 1000))
	for i := 0; i < 100; i++ {
		if _, err := f.lookup(deviceA, "203.0.113.7", "run"); err != nil {
			t.Fatalf("lookup %d: %v", i+1, err)
		}
	}
	_, err := f.lookup(deviceA, "203.0.113.7", "run")
	r := refusalOf(t, err)
	if r.Layer != LayerDeviceDaily || r.RetryAfter != time.Hour {
		t.Fatalf("refusal %+v, want the device layer, retry in the hour left to UTC midnight", r)
	}
	if f.resolver.calls() != 100 {
		t.Fatalf("dictionary read %d times, want 100: a refused lookup reads nothing", f.resolver.calls())
	}
	if _, err := f.lookup(deviceB, "203.0.113.7", "run"); err != nil {
		t.Fatalf("another device on the same IP: %v", err)
	}
	if f.obs.refused[LayerDeviceDaily] != 1 || f.obs.allowed != 101 {
		t.Fatalf("observed %d allowed, %v refused", f.obs.allowed, f.obs.refused)
	}
}

func TestAnonymousLookupIPDailyLimitWhateverTheDevice(t *testing.T) {
	f := newAnonFixture(limits(100, 3))
	devices := []string{deviceA, deviceB, "2d7b9e3a-6f2c-4b9a-9d4c-8e3f4a5b6c7d"}
	for _, d := range devices {
		if _, err := f.lookup(d, "203.0.113.7", "run"); err != nil {
			t.Fatal(err)
		}
	}
	_, err := f.lookup("3e8c0f4b-7a3d-4cab-ae5d-9f4a5b6c7d8e", "203.0.113.7", "run")
	if r := refusalOf(t, err); r.Layer != LayerIPDaily || r.RetryAfter != time.Hour {
		t.Fatalf("refusal %+v, want the IP layer, retry in an hour", r)
	}
	if f.devices.takes() != 3 {
		t.Fatalf("device store reached %d times, want 3: the IP layer refuses first", f.devices.takes())
	}
	if _, err := f.lookup(deviceA, "198.51.100.1", "run"); err != nil {
		t.Fatalf("another IP: %v", err)
	}
}

func TestAnonymousLookupIPv6AddressesInOne64ShareTheCountAndTheBucket(t *testing.T) {
	f := newAnonFixture(limits(100, 2))
	if _, err := f.lookup(deviceA, "2001:db8:1:2::1", "run"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.lookup(deviceB, "2001:db8:1:2:ffff::9", "run"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.lookup(deviceA, "2001:db8:1:2:abcd::5", "run"); refusalOf(t, err).Layer != LayerIPDaily {
		t.Fatalf("third lookup from the /64: %v, want the IP daily refusal", err)
	}
	if _, err := f.lookup(deviceA, "2001:db8:1:3::1", "run"); err != nil {
		t.Fatalf("the next /64 has its own count: %v", err)
	}
	if f.rate.keys[0] != f.rate.keys[1] || f.rate.keys[1] != f.rate.keys[2] || f.rate.keys[2] == f.rate.keys[3] {
		t.Fatalf("rate bucket keys %v, want one per /64", f.rate.keys)
	}
}

func TestAnonymousLookupRequestRate(t *testing.T) {
	f := newAnonFixture(limits(1, 1))
	f.rate.refuse = true
	_, err := f.lookup(deviceA, "203.0.113.7", "run")
	if r := refusalOf(t, err); r.Layer != LayerRate || r.RetryAfter != 7*time.Second {
		t.Fatalf("refusal %+v, want the rate layer with the limiter's wait", r)
	}
	if f.devices.takes() != 0 || f.resolver.calls() != 0 {
		t.Fatal("a rate-limited lookup must reach neither the device store nor the dictionary")
	}
	f.rate.refuse = false
	if _, err := f.lookup(deviceA, "203.0.113.7", "run"); err != nil {
		t.Fatalf("the rate refusal must not use up the daily counts: %v", err)
	}
	if f.obs.refused[LayerRate] != 1 {
		t.Fatalf("refused %v, want one at the rate layer", f.obs.refused)
	}
}

// A device past its limit must not use up a shared IP's allowance.
func TestAnonymousLookupDeviceRefusalDoesNotCountAgainstTheIP(t *testing.T) {
	f := newAnonFixture(limits(1, 2))
	if _, err := f.lookup(deviceA, "203.0.113.7", "run"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if _, err := f.lookup(deviceA, "203.0.113.7", "run"); refusalOf(t, err).Layer != LayerDeviceDaily {
			t.Fatalf("repeat %d: %v", i, err)
		}
	}
	if _, err := f.lookup(deviceB, "203.0.113.7", "run"); err != nil {
		t.Fatalf("the IP's second lookup: %v", err)
	}
}

func TestAnonymousLookupLimitsResetAtTheNextUTCDay(t *testing.T) {
	f := newAnonFixture(limits(1, 1))
	if _, err := f.lookup(deviceA, "203.0.113.7", "run"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.lookup(deviceA, "203.0.113.7", "run"); err == nil {
		t.Fatal("second lookup the same day was served")
	}
	f.now = time.Date(2026, 11, 27, 0, 0, 1, 0, time.UTC)
	if _, err := f.lookup(deviceA, "203.0.113.7", "run"); err != nil {
		t.Fatalf("first lookup of the next UTC day: %v", err)
	}
}

func TestAnonymousLookupServesWhenTheDeviceStoreFails(t *testing.T) {
	f := newAnonFixture(limits(1, 2))
	f.devices.err = errors.New("database is locked")
	for i := 0; i < 2; i++ {
		if _, err := f.lookup(deviceA, "203.0.113.7", "run"); err != nil {
			t.Fatalf("lookup %d with the device store down: %v", i+1, err)
		}
	}
	if _, err := f.lookup(deviceA, "203.0.113.7", "run"); refusalOf(t, err).Layer != LayerIPDaily {
		t.Fatalf("third lookup: %v, want the IP layer still to apply", err)
	}
}

func TestAnonymousLookupConcurrentRequestsStayWithinTheLimits(t *testing.T) {
	f := newAnonFixture(limits(100, 8))
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = f.lookup(deviceA, "203.0.113.7", "run")
		}()
	}
	wg.Wait()
	if got := f.resolver.calls(); got != 8 {
		t.Fatalf("%d lookups served, want 8 (the IP limit)", got)
	}
}

func TestClientKey(t *testing.T) {
	for _, tc := range []struct{ ip, want string }{
		{"203.0.113.7", "203.0.113.7"},
		{" 203.0.113.7 ", "203.0.113.7"},
		{"::ffff:203.0.113.7", "203.0.113.7"},
		{"2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"},
		{"fe80::1%eth0", "fe80::/64"},
		{"", sharedClientKey},
		{"not an ip", sharedClientKey},
	} {
		if got := ClientKey(tc.ip); got != tc.want {
			t.Errorf("ClientKey(%q) = %q, want %q", tc.ip, got, tc.want)
		}
	}
}
