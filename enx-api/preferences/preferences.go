// Package preferences keeps per-user settings on the server (ADR-044), so the
// server can read them and every client (enx-ui, the extension) shows the
// same value. A registry of known keys owns each key's type, default and
// editability; unknown keys are rejected rather than stored.
package preferences

import (
	"context"
	"errors"
	"fmt"
	"slices"

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
	// OnboardingCompleted: the user finished or skipped the first-run guide
	// on /welcome (ADR-047 Decision 1a). Written by the page, not shown on
	// the settings page. Not tied to payment state.
	OnboardingCompleted Key = "onboardingCompleted"
	// ExplanationLanguage: which language word explanations come in
	// (ADR-098 Decision 1). An enum, open to every signed-in user; more
	// languages are added as values, not as new keys.
	ExplanationLanguage Key = "explanationLanguage"
)

// ExplanationLanguage values.
const (
	ExplanationLanguageZhHans  = "zh-Hans"
	ExplanationLanguageEnglish = "en"
)

var (
	// ErrUnknownKey: the key is not in the registry.
	ErrUnknownKey = errors.New("preferences: unknown key")
	// ErrInvalidValue: the value has the wrong type for the key, or is not
	// one of an enum key's allowed values.
	ErrInvalidValue = errors.New("preferences: invalid value")
	// ErrNotEditable: the user's payment state does not let them change the
	// key.
	ErrNotEditable = errors.New("preferences: not editable for this user")
)

// Store persists explicit values. A key with no stored value is "unset" and
// takes its default. A value is a bool or a string, as the key's registry
// entry says; Load returns whatever is stored and the Service judges it.
type Store interface {
	Load(ctx context.Context, userID string) (map[Key]any, error)
	Save(ctx context.Context, userID string, key Key, value any) error
	Clear(ctx context.Context, userID string, key Key) error
}

// Entitlements supplies the payment state defaults and editability depend on.
type Entitlements interface {
	Status(ctx context.Context, userID string) (entitlement.Status, error)
}

// View is one preference as a client sees it.
type View struct {
	// Value is the user's explicit choice (a bool or a string); nil means
	// unset.
	Value any
	// Effective is what the server acts on, with the default and the user's
	// entitlement applied. Clients show it; they never recompute it.
	Effective any
	// Editable is whether the user may change it.
	Editable bool
}

// definition is one registry entry.
type definition struct {
	// allowed lists an enum key's values; nil makes the key a boolean.
	allowed      []string
	defaultValue func(entitlement.Status) any
	editable     func(entitlement.Status) bool
	// gatedByEditable: the effective value is false whenever the key is not
	// editable, whatever is stored -- how a lapsed subscription turns the
	// AI fallback off without losing the user's choice. Booleans only.
	gatedByEditable bool
}

func off(entitlement.Status) any { return false }

func always(entitlement.Status) bool { return true }

var registry = map[Key]definition{
	AIWordFallback: {
		// A top-up-only user may use AI but starts opted out: they may have
		// bought credit for translation, and each lookup would spend some.
		defaultValue:    func(s entitlement.Status) any { return s.Subscribed },
		editable:        func(s entitlement.Status) bool { return s.CanUseAI },
		gatedByEditable: true,
	},
	AIWordFallbackNoticeAck: {
		defaultValue: off,
		editable:     always,
	},
	OnboardingCompleted: {
		defaultValue: off,
		editable:     always,
	},
	ExplanationLanguage: {
		allowed:      []string{ExplanationLanguageZhHans, ExplanationLanguageEnglish},
		defaultValue: func(entitlement.Status) any { return ExplanationLanguageZhHans },
		editable:     always,
	},
}

// valid reports whether value is one this key may hold.
func (d definition) valid(value any) bool {
	if d.allowed == nil {
		_, ok := value.(bool)
		return ok
	}
	s, ok := value.(string)
	return ok && slices.Contains(d.allowed, s)
}

// view builds what a client sees. A stored value the key may no longer hold
// reads as unset.
func (d definition) view(status entitlement.Status, stored any) View {
	editable := d.editable(status)
	var explicit any
	effective := d.defaultValue(status)
	if d.valid(stored) {
		explicit, effective = stored, stored
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
		views[key] = def.view(status, stored[key])
	}
	return views, nil
}

// Effective returns the value the server should act on for one boolean key.
// It is how server-side features (ADR-045's AI fallback) read a preference.
// Asked for a non-boolean key it errors rather than answering false.
func (s *Service) Effective(ctx context.Context, userID string, key Key) (bool, error) {
	if _, ok := registry[key]; !ok {
		return false, fmt.Errorf("%w: %q", ErrUnknownKey, key)
	}
	views, err := s.Get(ctx, userID)
	if err != nil {
		return false, err
	}
	on, ok := views[key].Effective.(bool)
	if !ok {
		return false, fmt.Errorf("preferences: %q is not a boolean preference", key)
	}
	return on, nil
}

// EffectiveEnum is Effective for an enum key. Asked for a boolean key it
// errors rather than answering "".
func (s *Service) EffectiveEnum(ctx context.Context, userID string, key Key) (string, error) {
	if _, ok := registry[key]; !ok {
		return "", fmt.Errorf("%w: %q", ErrUnknownKey, key)
	}
	views, err := s.Get(ctx, userID)
	if err != nil {
		return "", err
	}
	value, ok := views[key].Effective.(string)
	if !ok {
		return "", fmt.Errorf("preferences: %q is not an enum preference", key)
	}
	return value, nil
}

// Update applies changes, given as decoded JSON values: a non-nil value
// stores an explicit choice, a nil value clears it (back to the default). It
// validates every key before writing any, so a rejected request changes
// nothing. It returns ErrUnknownKey, ErrInvalidValue or ErrNotEditable
// (wrapped with the key) on rejection, checked in that order for each key.
func (s *Service) Update(ctx context.Context, userID string, changes map[string]any) error {
	status, err := s.ent.Status(ctx, userID)
	if err != nil {
		return err
	}
	for name, value := range changes {
		def, ok := registry[Key(name)]
		if !ok {
			return fmt.Errorf("%w: %q", ErrUnknownKey, name)
		}
		if value != nil && !def.valid(value) {
			return fmt.Errorf("%w: %q", ErrInvalidValue, name)
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
			err = s.store.Save(ctx, userID, key, value)
		}
		if err != nil {
			return err
		}
	}
	return nil
}
