// Package preferences keeps per-user settings on the server (ADR-044), so the
// server can read them and every client (enx-ui, the extension) shows the
// same value. A registry of known keys owns each key's type, default and
// editability; unknown keys are rejected rather than stored.
package preferences

import (
	"context"
	"errors"
	"fmt"

	"enx-api/entitlement"
)

// Key names a preference.
type Key string

const (
	// AIWordFallback: look a word up with AI when the dictionaries miss
	// (ADR-045). On by default for subscribers, off for everyone else, and
	// only changeable by users who may use AI at all.
	AIWordFallback Key = "aiWordFallback"
	// AIWordFallbackNoticeAck: the user has seen the one-time notice that
	// the looked-up word is sent to an AI provider (ADR-045 Decision 10).
	// Not tied to payment state.
	AIWordFallbackNoticeAck Key = "aiWordFallbackNoticeAck"
)

var (
	// ErrUnknownKey: the key is not in the registry.
	ErrUnknownKey = errors.New("preferences: unknown key")
	// ErrNotEditable: the user's payment state does not let them change the
	// key.
	ErrNotEditable = errors.New("preferences: not editable for this user")
)

// Store persists explicit values. A key with no stored value is "unset" and
// takes its default.
type Store interface {
	Load(ctx context.Context, userID string) (map[Key]bool, error)
	Save(ctx context.Context, userID string, key Key, value bool) error
	Clear(ctx context.Context, userID string, key Key) error
}

// Entitlements supplies the payment state defaults and editability depend on.
type Entitlements interface {
	Status(ctx context.Context, userID string) (entitlement.Status, error)
}

// View is one preference as a client sees it.
type View struct {
	// Value is the user's explicit choice; nil means unset.
	Value *bool
	// Effective is what the server acts on, with the default and the user's
	// entitlement applied. Clients show it; they never recompute it.
	Effective bool
	// Editable is whether the user may change it.
	Editable bool
}

// definition is one registry entry.
type definition struct {
	defaultValue func(entitlement.Status) bool
	editable     func(entitlement.Status) bool
	// gatedByEditable: the effective value is false whenever the key is not
	// editable, whatever is stored -- how a lapsed subscription turns the
	// AI fallback off without losing the user's choice.
	gatedByEditable bool
}

var registry = map[Key]definition{
	AIWordFallback: {
		// A top-up-only user may use AI but starts opted out: they may have
		// bought credit for translation, and each lookup would spend some.
		defaultValue:    func(s entitlement.Status) bool { return s.Subscribed },
		editable:        func(s entitlement.Status) bool { return s.CanUseAI },
		gatedByEditable: true,
	},
	AIWordFallbackNoticeAck: {
		defaultValue: func(entitlement.Status) bool { return false },
		editable:     func(entitlement.Status) bool { return true },
	},
}

func (d definition) view(status entitlement.Status, explicit *bool) View {
	editable := d.editable(status)
	effective := d.defaultValue(status)
	if explicit != nil {
		effective = *explicit
	}
	if d.gatedByEditable && !editable {
		effective = false
	}
	return View{Value: explicit, Effective: effective, Editable: editable}
}

// Service reads and writes users' preferences.
type Service struct {
	store Store
	ent   Entitlements
}

func NewService(store Store, ent Entitlements) *Service {
	return &Service{store: store, ent: ent}
}

// Get returns every registered preference for userID.
func (s *Service) Get(ctx context.Context, userID string) (map[Key]View, error) {
	status, err := s.ent.Status(ctx, userID)
	if err != nil {
		return nil, err
	}
	stored, err := s.store.Load(ctx, userID)
	if err != nil {
		return nil, err
	}
	views := make(map[Key]View, len(registry))
	for key, def := range registry {
		var explicit *bool
		if v, ok := stored[key]; ok {
			explicit = &v
		}
		views[key] = def.view(status, explicit)
	}
	return views, nil
}

// Effective returns the value the server should act on for one key. It is
// how server-side features (ADR-045's AI fallback) read a preference.
func (s *Service) Effective(ctx context.Context, userID string, key Key) (bool, error) {
	if _, ok := registry[key]; !ok {
		return false, fmt.Errorf("%w: %q", ErrUnknownKey, key)
	}
	views, err := s.Get(ctx, userID)
	if err != nil {
		return false, err
	}
	return views[key].Effective, nil
}

// Update applies changes: a non-nil value stores an explicit choice, a nil
// value clears it (back to the default). It validates every key before
// writing any, so a rejected request changes nothing. It returns
// ErrUnknownKey or ErrNotEditable (wrapped with the key) on rejection.
func (s *Service) Update(ctx context.Context, userID string, changes map[string]*bool) error {
	status, err := s.ent.Status(ctx, userID)
	if err != nil {
		return err
	}
	for name := range changes {
		def, ok := registry[Key(name)]
		if !ok {
			return fmt.Errorf("%w: %q", ErrUnknownKey, name)
		}
		if !def.editable(status) {
			return fmt.Errorf("%w: %q", ErrNotEditable, name)
		}
	}
	for name, value := range changes {
		key := Key(name)
		if value == nil {
			err = s.store.Clear(ctx, userID, key)
		} else {
			err = s.store.Save(ctx, userID, key, *value)
		}
		if err != nil {
			return err
		}
	}
	return nil
}
