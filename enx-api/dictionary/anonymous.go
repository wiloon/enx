package dictionary

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/netip"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"enx-api/utils/logger"

	"github.com/google/uuid"
)

// Anonymous lookup (ADR-095): a dictionary definition for a click without an
// account, limited per device and per IP. It writes nothing per user.

// MaxAnonymousWordLength is the longest word, in characters as sent, an
// anonymous lookup accepts.
const MaxAnonymousWordLength = 64

var (
	// ErrAnonymousLookupDisabled: the switch is off; every anonymous lookup
	// is refused.
	ErrAnonymousLookupDisabled = errors.New("dictionary: anonymous lookup is turned off")
	// ErrInvalidDeviceID: the anonymous device id is missing or not a UUID.
	ErrInvalidDeviceID = errors.New("dictionary: invalid anonymous device id")
	// ErrInvalidAnonymousWord: the word is too long, not a single word, or nothing
	// once normalized.
	ErrInvalidAnonymousWord = errors.New("dictionary: invalid word")
)

// AnonymousLimits configure anonymous lookup. DeviceDaily and IPDaily are
// served lookups per UTC day; both must be positive.
type AnonymousLimits struct {
	Enabled     bool
	DeviceDaily int64
	IPDaily     int64
}

// AnonymousLayer names the limit that refused an anonymous lookup.
type AnonymousLayer string

const (
	LayerRate        AnonymousLayer = "rate"         // per-IP request rate
	LayerIPDaily     AnonymousLayer = "ip_daily"     // per-IP served lookups per UTC day
	LayerDeviceDaily AnonymousLayer = "device_daily" // per-device served lookups per UTC day
)

// AnonymousRefusal is a lookup a limit refused. RetryAfter is whole seconds,
// at least one: the limiter's wait for LayerRate, the time to the next UTC
// midnight for the daily layers.
type AnonymousRefusal struct {
	Layer      AnonymousLayer
	RetryAfter time.Duration
}

func (r *AnonymousRefusal) Error() string {
	return fmt.Sprintf("dictionary: anonymous lookup refused by the %s limit", r.Layer)
}

// RequestLimiter is the per-key request rate: ratelimit.MemoryLimiter in
// production, with the ADR-060 rule and a bucket of its own.
type RequestLimiter interface {
	Allow(key string) (ok bool, retryAfter time.Duration)
}

// IPDailyCounter counts served lookups per client key and UTC day.
// MemoryIPDailyCounter in production: IPs never reach disk (ADR-095
// Decision 5).
type IPDailyCounter interface {
	// Reserve adds one to key's count for day unless it already has limit.
	Reserve(key string, day time.Time, limit int64) bool
	// Release takes back one Reserve of the same key and day.
	Release(key string, day time.Time)
}

// DeviceUsageStore counts served lookups per device hash and UTC day.
type DeviceUsageStore interface {
	// Take adds one to deviceHash's count for day unless it already has
	// limit; ok is false when refused. Concurrent takes never pass limit.
	Take(ctx context.Context, deviceHash string, day time.Time, limit int64) (ok bool, err error)
}

// AnonymousObserver hears every anonymous lookup that reached the limits:
// metrics.Metrics in production. No device or IP is passed.
type AnonymousObserver interface {
	ObserveAnonymousLookupAllowed()
	ObserveAnonymousLookupRefused(layer string)
}

// AnonymousRequest is one anonymous lookup as received: the raw device id,
// the client IP ("" when unknown) and the word as sent.
type AnonymousRequest struct {
	DeviceID string
	ClientIP string
	Word     string
}

// AnonymousLookups serves anonymous lookups through the one lookup seam
// (Service.Resolve, for NoUser) behind the ADR-095 limits.
type AnonymousLookups struct {
	resolver Resolver
	rate     RequestLimiter
	ipDaily  IPDailyCounter
	devices  DeviceUsageStore
	limits   AnonymousLimits
	now      func() time.Time
	obs      AnonymousObserver
}

func NewAnonymousLookups(resolver Resolver, rate RequestLimiter, ipDaily IPDailyCounter, devices DeviceUsageStore, limits AnonymousLimits, now func() time.Time) *AnonymousLookups {
	return &AnonymousLookups{resolver: resolver, rate: rate, ipDaily: ipDaily, devices: devices, limits: limits, now: now}
}

// WithObserver reports each outcome to obs.
func (a *AnonymousLookups) WithObserver(obs AnonymousObserver) *AnonymousLookups {
	a.obs = obs
	return a
}

// Enabled is the on/off switch, checked before anything else.
func (a *AnonymousLookups) Enabled() bool { return a.limits.Enabled }

// Lookup checks, in order: the switch, the request, the IP request rate, the
// IP daily count and the device daily count; then resolves the word for
// NoUser. Only a lookup that passes every check (served, whatever it
// resolves to) adds to the daily counts, so a device past its limit cannot
// use up a shared IP's allowance. A device store failure is logged and the
// lookup served: the IP layers are the defence (ADR-095 Decision 5).
//
// Errors: ErrAnonymousLookupDisabled, ErrInvalidDeviceID, ErrInvalidAnonymousWord or
// an *AnonymousRefusal. A lookup that cannot be answered is EntryFailed.
func (a *AnonymousLookups) Lookup(ctx context.Context, req AnonymousRequest) (EntryResult, error) {
	if !a.limits.Enabled {
		return EntryResult{}, ErrAnonymousLookupDisabled
	}
	deviceHash, err := hashDeviceID(req.DeviceID)
	if err != nil {
		return EntryResult{}, err
	}
	word, err := anonymousWord(req.Word)
	if err != nil {
		return EntryResult{}, err
	}

	key := ClientKey(req.ClientIP)
	if ok, retryAfter := a.rate.Allow(key); !ok {
		return EntryResult{}, a.refuse(LayerRate, retryAfter)
	}
	now := a.now().UTC()
	if !a.ipDaily.Reserve(key, now, a.limits.IPDaily) {
		return EntryResult{}, a.refuse(LayerIPDaily, untilNextUTCDay(now))
	}
	ok, err := a.devices.Take(ctx, deviceHash, now, a.limits.DeviceDaily)
	switch {
	case err != nil:
		// Neither the id nor its hash goes to the log.
		logger.Warnf("dictionary: anonymous device usage failed, serving the lookup: %v", err)
	case !ok:
		a.ipDaily.Release(key, now)
		return EntryResult{}, a.refuse(LayerDeviceDaily, untilNextUTCDay(now))
	}

	if a.obs != nil {
		a.obs.ObserveAnonymousLookupAllowed()
	}
	return resolveEntry(ctx, a.resolver, word, NoUser), nil
}

func (a *AnonymousLookups) refuse(layer AnonymousLayer, retryAfter time.Duration) error {
	if a.obs != nil {
		a.obs.ObserveAnonymousLookupRefused(string(layer))
	}
	return &AnonymousRefusal{Layer: layer, RetryAfter: retryAfter}
}

// hashDeviceID is the SHA-256 (hex) of the device id in its canonical
// lowercase form; only this is ever stored (ADR-095 Decision 4).
func hashDeviceID(raw string) (string, error) {
	// uuid.Parse also takes the urn: and braced forms; the extension sends
	// the plain 36-character one.
	if len(raw) != 36 {
		return "", ErrInvalidDeviceID
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return "", ErrInvalidDeviceID
	}
	sum := sha256.Sum256([]byte(id.String()))
	return hex.EncodeToString(sum[:]), nil
}

// anonymousWord applies the batch endpoint's word rules plus a length cap on
// the word as sent.
func anonymousWord(raw string) (string, error) {
	if utf8.RuneCountInString(raw) > MaxAnonymousWordLength {
		return "", fmt.Errorf("%w: longer than %d characters", ErrInvalidAnonymousWord, MaxAnonymousWordLength)
	}
	words, err := distinctWords([]string{raw})
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalidAnonymousWord, err)
	}
	return words[0], nil
}

// sharedClientKey is the one bucket of every request whose client IP is
// unknown: the configured header missing or not an IP. The limits still
// apply to it (ADR-095 Decision 6).
const sharedClientKey = "unknown"

// ClientKey is the key both IP layers count under: the IPv4 address, the
// IPv6 /64 prefix, or the shared bucket.
func ClientKey(ip string) string {
	addr, err := netip.ParseAddr(strings.TrimSpace(ip))
	if err != nil {
		return sharedClientKey
	}
	addr = addr.Unmap().WithZone("")
	if addr.Is4() {
		return addr.String()
	}
	prefix, err := addr.Prefix(64)
	if err != nil {
		return sharedClientKey
	}
	return prefix.String()
}

// untilNextUTCDay is the whole seconds, at least one, from now to the next
// UTC midnight, when the daily limits reset.
func untilNextUTCDay(now time.Time) time.Duration {
	now = now.UTC()
	next := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
	s := (next.Sub(now) + time.Second - 1) / time.Second
	if s < 1 {
		s = 1
	}
	return s * time.Second
}

// MemoryIPDailyCounter keeps the per-IP daily counts in process memory: a
// restart clears them, which ADR-095 Decision 5 accepts. Only the current
// UTC day is held.
type MemoryIPDailyCounter struct {
	mu     sync.Mutex
	day    string
	counts map[string]int64
}

func NewMemoryIPDailyCounter() *MemoryIPDailyCounter {
	return &MemoryIPDailyCounter{counts: map[string]int64{}}
}

func (m *MemoryIPDailyCounter) Reserve(key string, day time.Time, limit int64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if d := day.UTC().Format(time.DateOnly); d != m.day {
		m.day = d
		m.counts = map[string]int64{}
	}
	if m.counts[key] >= limit {
		return false
	}
	m.counts[key]++
	return true
}

func (m *MemoryIPDailyCounter) Release(key string, day time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if day.UTC().Format(time.DateOnly) != m.day || m.counts[key] == 0 {
		return
	}
	m.counts[key]--
}
