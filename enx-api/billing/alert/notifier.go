package alert

import (
	"context"
	"errors"
	"time"
)

// Kind is where a durable alert lives: an event's attention alert on its
// webhook event task, and a conflict's discovery and support alerts on the
// conflicting subscription.
type Kind string

const (
	EventAttentionAlert Kind = "event_attention"
	ConflictAlert       Kind = "subscription_conflict"
	SupportAlert        Kind = "billing_support"
)

// Ref identifies one alert: its kind and the scoped Event ID or the
// Subscription ID it belongs to.
type Ref struct {
	Kind Kind
	ID   string
	// AccountID and Livemode scope an event attention alert's Event ID; a
	// subscription's alerts leave them empty.
	AccountID string
	Livemode  bool
}

// Content is what an alert's mail is composed from: EventAttention,
// ConflictFound or SupportRequested.
type Content interface{ Mail() Mail }

// Stored is a pending alert as the store read it.
type Stored struct {
	Ref     Ref
	Alert   Alert
	Content Content
}

// Store reads and writes alert delivery state.
type Store interface {
	// Pending returns every pending alert; the notifier decides which are
	// due.
	Pending(ctx context.Context) ([]Stored, error)
	// Save writes next as ref's state only while the stored state still
	// equals read, and returns ErrStaleClaim otherwise. Comparing the claim
	// token alone is not enough: a send's outcome clears it, so a notifier
	// that read the alert before another one sent it would claim it again.
	// State, Attempts and ClaimToken together change on every transition.
	Save(ctx context.Context, ref Ref, read, next Alert) error
}

// Mailer sends an administrator alert mail. A nil error means the provider
// confirmed the send; email.Sender.SendAdminAlert is the production one.
type Mailer interface {
	SendAdminAlert(ctx context.Context, subject, text string) error
}

// NotifierSettings are the stripe.webhook notification settings. Timeout
// must be shorter than Lease, so a claim cannot lapse while its send may
// still succeed.
type NotifierSettings struct {
	// Timeout bounds one send (notification-timeout).
	Timeout time.Duration
	// Lease is how long a claim keeps other notifiers away
	// (notification-lease-duration).
	Lease time.Duration
	// RetryAfter is when a failed alert is due again on the hourly pass
	// (notification-poll-interval).
	RetryAfter time.Duration
}

// Report counts the sends a pass attempted.
type Report struct {
	Sent   int
	Failed int
}

// Notifier sends pending administrator alerts (ADR-067 §管理员处理与邮件):
// at startup and on every poll tick it claims each due alert, sends its
// mail outside any transaction and records the outcome under that claim.
// Several notifiers may share one store; the claim keeps them from sending
// the same alert twice.
type Notifier struct {
	store    Store
	mailer   Mailer
	settings NotifierSettings
	now      func() time.Time
	newToken func() string
}

// NewNotifier returns a notifier. newToken must return a fresh, unique
// claim token on every call.
func NewNotifier(store Store, mailer Mailer, settings NotifierSettings, now func() time.Time, newToken func() string) *Notifier {
	return &Notifier{store: store, mailer: mailer, settings: settings, now: now, newToken: newToken}
}

// Run makes a startup pass, then an hourly pass on every tick, until ctx is
// done. report gets each pass's outcome.
func (n *Notifier) Run(ctx context.Context, ticks <-chan time.Time, report func(Report, error)) {
	report(n.Pass(ctx, StartupPass))
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticks:
			report(n.Pass(ctx, HourlyPass))
		}
	}
}

// Pass sends every alert due on pass. A failed send keeps its alert pending
// and is not an error; storage failures are, and do not stop the pass.
func (n *Notifier) Pass(ctx context.Context, pass Pass) (Report, error) {
	pending, err := n.store.Pending(ctx)
	if err != nil {
		return Report{}, err
	}
	var report Report
	var errs []error
	for _, s := range pending {
		sent, err := n.deliver(ctx, s, pass)
		switch {
		case errors.Is(err, errSkipped):
		case err != nil:
			errs = append(errs, err)
		case sent:
			report.Sent++
		default:
			report.Failed++
		}
	}
	return report, errors.Join(errs...)
}

// errSkipped: the alert was not due, or another notifier holds it.
var errSkipped = errors.New("billing/alert: skipped")

// deliver claims, sends and records one alert, reporting whether the
// provider confirmed the send.
func (n *Notifier) deliver(ctx context.Context, s Stored, pass Pass) (bool, error) {
	token := n.newToken()
	claimed, err := Claim(s.Alert, token, n.now(), n.settings.Lease, pass)
	if err != nil {
		return false, errSkipped
	}
	if err := n.store.Save(ctx, s.Ref, s.Alert, claimed); err != nil {
		if errors.Is(err, ErrStaleClaim) {
			return false, errSkipped
		}
		return false, err
	}

	mail := s.Content.Mail()
	sendCtx, cancel := context.WithTimeout(ctx, n.settings.Timeout)
	sendErr := n.mailer.SendAdminAlert(sendCtx, mail.Subject, mail.Text)
	cancel()

	var next Alert
	if sendErr == nil {
		next, err = MarkSent(claimed, token, n.now())
	} else {
		next, err = MarkFailed(claimed, token, n.now(), sendErr.Error(), n.settings.RetryAfter)
	}
	if err != nil {
		return false, err
	}
	if err := n.store.Save(ctx, s.Ref, claimed, next); err != nil {
		if errors.Is(err, ErrStaleClaim) {
			return false, errSkipped
		}
		return false, err
	}
	return sendErr == nil, nil
}
