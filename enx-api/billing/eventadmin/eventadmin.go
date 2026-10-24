// Package eventadmin is the administrator's view of durably received
// Stripe webhook events (ADR-067 §管理员处理与邮件), behind
// /api/admin/webhook-events: list them by processing state, read one with
// every delivery and its original payload, and retry one that needs
// attention. An event is identified by its Stripe Event ID, scoped to the
// endpoint discovered at billing startup.
//
// A retry requeues the same event with webhookevent.RetryByOperator: its
// idempotency keys, dependency-wait clock and alert are kept, so a retry
// never grants twice and never sends a sent alert again. Nothing here
// cancels, refunds or changes the accepted subscription.
package eventadmin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"enx-api/billing/webhookevent"
)

var (
	// ErrUnavailable: the endpoint is not discovered yet, or the store
	// could not read or save. Nothing was recorded; retry later.
	ErrUnavailable = errors.New("billing/eventadmin: webhook events unavailable")
	// ErrNotFound: ENX has no event with the ID for this endpoint.
	ErrNotFound = errors.New("billing/eventadmin: no webhook event with that ID")
	// ErrInvalidStatus: the list names a status that is not a webhook event
	// processing state.
	ErrInvalidStatus = errors.New("billing/eventadmin: invalid webhook event status")
	// ErrNotRetryable: only an event that needs attention can be retried.
	ErrNotRetryable = webhookevent.ErrNotRetryable
)

// List page bounds, as for subscription conflicts.
const (
	DefaultListLimit = 50
	MaxListLimit     = 200
)

// ListQuery is one page of GET /api/admin/webhook-events, newest receipt
// first.
type ListQuery struct {
	Status webhookevent.Status
	Limit  int
	Offset int
}

// ParseListQuery validates the status filter and bounds the page. Without a
// status it lists the events that need attention.
func ParseListQuery(status string, limit, offset int) (ListQuery, error) {
	s := webhookevent.Status(status)
	switch s {
	case "":
		s = webhookevent.NeedsAttention
	case webhookevent.Pending, webhookevent.Processing, webhookevent.WaitingDependency,
		webhookevent.Processed, webhookevent.NeedsAttention, webhookevent.Ignored:
	default:
		return ListQuery{}, ErrInvalidStatus
	}
	if limit <= 0 {
		limit = DefaultListLimit
	}
	return ListQuery{Status: s, Limit: min(limit, MaxListLimit), Offset: max(offset, 0)}, nil
}

// Event is a webhook event as an administrator inspects it: what receipt
// read from it and its processing task, alert included.
type Event struct {
	Scope      webhookevent.Scope
	APIVersion string
	// Created is Stripe's creation time of the event, not a causal order.
	Created time.Time
	Refs    webhookevent.References
	Task    webhookevent.Task
}

// Delivery is one verified HTTP delivery of the event.
type Delivery struct {
	ID         string
	ReceivedAt time.Time
}

// Detail is one event with every delivery and the original payload of its
// first delivery.
type Detail struct {
	Event      Event
	Deliveries []Delivery
	Payload    json.RawMessage
}

// Store reads webhook events and saves an operator retry.
type Store interface {
	// ListEvents reads one page of the endpoint's events in q.Status,
	// newest receipt first.
	ListEvents(ctx context.Context, endpoint webhookevent.Endpoint, q ListQuery) ([]Event, error)
	// Event reads one event, or returns ErrNotFound.
	Event(ctx context.Context, scope webhookevent.Scope) (Detail, error)
	// Save is webhookevent.TaskStore.Save: it writes next only while the
	// stored task still matches read, otherwise returns
	// webhookevent.ErrStaleClaim, and never overwrites the alert's
	// delivery progress.
	Save(ctx context.Context, scope webhookevent.Scope, read, next webhookevent.Task, effects webhookevent.Effects) error
}

// Service serves the administrator's webhook event API.
type Service struct {
	store    Store
	endpoint func() webhookevent.Endpoint
	now      func() time.Time
}

// New returns a Service for the endpoint as discovered so far
// (webhookevent.Identity.Endpoint), reading the time from now.
func New(store Store, endpoint func() webhookevent.Endpoint, now func() time.Time) *Service {
	return &Service{store: store, endpoint: endpoint, now: now}
}

// List returns one page of the endpoint's events. status is "" (needs
// attention) or a processing state; an unknown one is ErrInvalidStatus.
func (s *Service) List(ctx context.Context, status string, limit, offset int) ([]Event, error) {
	q, err := ParseListQuery(status, limit, offset)
	if err != nil {
		return nil, err
	}
	e, err := s.discovered()
	if err != nil {
		return nil, err
	}
	events, err := s.store.ListEvents(ctx, e, q)
	if err != nil {
		return nil, unavailable(err)
	}
	return events, nil
}

// Detail returns the event eventID with its deliveries and payload.
func (s *Service) Detail(ctx context.Context, eventID string) (Detail, error) {
	e, err := s.discovered()
	if err != nil {
		return Detail{}, err
	}
	return s.read(ctx, e.Scope(eventID))
}

// saveAttempts bounds the read-and-save rounds a retry makes while
// concurrent writes keep moving the task.
const saveAttempts = 3

// Retry requeues the event eventID, which must need attention, and returns
// it as saved. A retry that lost a race is judged against what committed.
func (s *Service) Retry(ctx context.Context, eventID string) (Event, error) {
	e, err := s.discovered()
	if err != nil {
		return Event{}, err
	}
	scope := e.Scope(eventID)
	for range saveAttempts {
		var ev Event
		var done bool
		ev, done, err = s.attemptRetry(ctx, scope)
		if done {
			return ev, err
		}
	}
	return Event{}, unavailable(err)
}

// attemptRetry reads the task and saves its requeued state. done is false
// only when the task moved under the save and a new round should start.
func (s *Service) attemptRetry(ctx context.Context, scope webhookevent.Scope) (Event, bool, error) {
	d, err := s.read(ctx, scope)
	if err != nil {
		return Event{}, true, err
	}
	next, err := webhookevent.RetryByOperator(d.Event.Task, s.now())
	if err != nil {
		return Event{}, true, err
	}
	err = s.store.Save(ctx, scope, d.Event.Task, next, nil)
	switch {
	case errors.Is(err, webhookevent.ErrStaleClaim):
		return Event{}, false, err
	case err != nil:
		return Event{}, true, unavailable(err)
	}
	ev := d.Event
	ev.Task = next
	return ev, true, nil
}

func (s *Service) discovered() (webhookevent.Endpoint, error) {
	e := s.endpoint()
	if e.AccountID == "" {
		return e, unavailable(webhookevent.ErrEndpointUnknown)
	}
	return e, nil
}

func (s *Service) read(ctx context.Context, scope webhookevent.Scope) (Detail, error) {
	d, err := s.store.Event(ctx, scope)
	if errors.Is(err, ErrNotFound) {
		return Detail{}, err
	}
	if err != nil {
		return Detail{}, unavailable(err)
	}
	return d, nil
}

func unavailable(err error) error {
	return fmt.Errorf("%w: %w", ErrUnavailable, err)
}
