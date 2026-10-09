// Package entitlement decides what a user's payment state allows (ADR-045
// Decision 14): one judgement shared by the AI word fallback, the cached AI
// definitions it leaves in `words`, and the preference that switches it.
package entitlement

import "context"

// Status is a user's payment state.
type Status struct {
	// Subscribed: the user has an active subscription (ADR-029's "subscribed"
	// tier).
	Subscribed bool
	// CanUseAI: the user may use AI features -- an active subscription, a
	// top-up balance above zero, or an unexpired sign-up trial with credits
	// left (ADR-048). This matches how the existing AI features are gated:
	// they look at credit, not at the subscription.
	CanUseAI bool
	// TrialOnly: the user's AI access comes from the trial alone -- no
	// subscription, no positive top-up. Only these users are held to the
	// trial's call-rate limits (ADR-048 Decision 7).
	TrialOnly bool
}

// Source reads the payment facts Status is derived from.
type Source interface {
	IsActiveSubscriber(ctx context.Context, userID string) (bool, error)
	// TopupBalance is the user's top-up credit balance; it can be negative
	// (billing/credit.Settle lets a settled call overdraw it).
	TopupBalance(ctx context.Context, userID string) (int64, error)
	// TrialBalance is the user's spendable trial credit: zero once the
	// trial has expired.
	TrialBalance(ctx context.Context, userID string) (int64, error)
}

// Service derives a user's Status from a Source.
type Service struct {
	source Source
}

func NewService(source Source) *Service {
	return &Service{source: source}
}

// CanUseAI reports whether userID may use AI features (see Status.CanUseAI).
func (s *Service) CanUseAI(ctx context.Context, userID string) (bool, error) {
	status, err := s.Status(ctx, userID)
	return status.CanUseAI, err
}

// Status returns userID's payment state. A subscriber is entitled without
// the top-up balance being read: an active subscription already answers
// both questions.
func (s *Service) Status(ctx context.Context, userID string) (Status, error) {
	subscribed, err := s.source.IsActiveSubscriber(ctx, userID)
	if err != nil {
		return Status{}, err
	}
	if subscribed {
		return Status{Subscribed: true, CanUseAI: true}, nil
	}
	topup, err := s.source.TopupBalance(ctx, userID)
	if err != nil {
		return Status{}, err
	}
	if topup > 0 {
		return Status{CanUseAI: true}, nil
	}
	trial, err := s.source.TrialBalance(ctx, userID)
	if err != nil {
		return Status{}, err
	}
	return Status{CanUseAI: trial > 0, TrialOnly: trial > 0}, nil
}
