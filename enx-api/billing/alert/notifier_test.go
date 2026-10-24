package alert

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeStore keeps alerts in memory and saves with the conditional write a
// repository does: on the state, attempts and claim token read.
type fakeStore struct {
	mu      sync.Mutex
	alerts  map[Ref]Stored
	listErr error
	saveErr map[Ref]error
}

func newFakeStore(stored ...Stored) *fakeStore {
	s := &fakeStore{alerts: map[Ref]Stored{}, saveErr: map[Ref]error{}}
	for _, a := range stored {
		s.alerts[a.Ref] = a
	}
	return s
}

func (s *fakeStore) Pending(context.Context) ([]Stored, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listErr != nil {
		return nil, s.listErr
	}
	var out []Stored
	for _, a := range s.alerts {
		if a.Alert.State == Pending {
			out = append(out, a)
		}
	}
	return out, nil
}

func (s *fakeStore) Save(_ context.Context, ref Ref, read, next Alert) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.saveErr[ref]; err != nil {
		return err
	}
	cur, ok := s.alerts[ref]
	if !ok || cur.Alert.State != read.State || cur.Alert.Attempts != read.Attempts || cur.Alert.ClaimToken != read.ClaimToken {
		return ErrStaleClaim
	}
	cur.Alert = next
	s.alerts[ref] = cur
	return nil
}

func (s *fakeStore) get(ref Ref) Alert {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.alerts[ref].Alert
}

type sentMail struct {
	Subject, Text string
	Deadline      time.Time
}

type fakeMailer struct {
	mu   sync.Mutex
	sent []sentMail
	err  error
	send func(ctx context.Context) error
}

func (m *fakeMailer) SendAdminAlert(ctx context.Context, subject, text string) error {
	if m.send != nil {
		if err := m.send(ctx); err != nil {
			return err
		}
	}
	deadline, _ := ctx.Deadline()
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return m.err
	}
	m.sent = append(m.sent, sentMail{Subject: subject, Text: text, Deadline: deadline})
	return nil
}

func (m *fakeMailer) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sent)
}

var (
	settings = NotifierSettings{Timeout: 30 * time.Second, Lease: lease, RetryAfter: hour}

	eventRef    = Ref{Kind: EventAttentionAlert, ID: "evt_1"}
	conflictRef = Ref{Kind: ConflictAlert, ID: "sub_B"}
	supportRef  = Ref{Kind: SupportAlert, ID: "sub_B"}

	eventContent    = EventAttention{AccountID: "acct_1", EventID: "evt_1", EventType: "invoice.paid", Reason: "attribution_unresolved"}
	conflictContent = ConflictFound{SubscriptionID: "sub_B", AcceptedSubscriptionID: "sub_A", OwnerID: "42"}
	supportContent  = SupportRequested{SubscriptionID: "sub_B", OwnerID: "42", RequestedAt: t0}
)

func fixedClock(t time.Time) func() time.Time { return func() time.Time { return t } }

func tokens(prefix string) func() string {
	var n atomic.Int64
	return func() string { return fmt.Sprintf("%s_%d", prefix, n.Add(1)) }
}

func TestNotifierSendsEveryDueAlertAndMarksItSent(t *testing.T) {
	store := newFakeStore(
		Stored{Ref: eventRef, Alert: Raise(Alert{}, t0), Content: eventContent},
		Stored{Ref: conflictRef, Alert: Raise(Alert{}, t0), Content: conflictContent},
		Stored{Ref: supportRef, Alert: Raise(Alert{}, t0), Content: supportContent},
	)
	mailer := &fakeMailer{}
	now := t0.Add(time.Minute)
	n := NewNotifier(store, mailer, settings, fixedClock(now), tokens("tok"))

	report, err := n.Pass(context.Background(), HourlyPass)
	if err != nil {
		t.Fatal(err)
	}
	if report != (Report{Sent: 3}) {
		t.Errorf("report = %+v, want 3 sent", report)
	}
	for _, ref := range []Ref{eventRef, conflictRef, supportRef} {
		if got, want := store.get(ref), (Alert{State: Sent, Attempts: 1, SentAt: now}); got != want {
			t.Errorf("%v = %+v, want %+v", ref, got, want)
		}
	}

	wantMails := map[string]string{}
	for _, c := range []Content{eventContent, conflictContent, supportContent} {
		m := c.Mail()
		wantMails[m.Subject] = m.Text
	}
	if len(mailer.sent) != 3 {
		t.Fatalf("sent %d mails, want 3", len(mailer.sent))
	}
	for _, m := range mailer.sent {
		if text, ok := wantMails[m.Subject]; !ok || text != m.Text {
			t.Errorf("sent unexpected mail %q", m.Subject)
		}
	}
}

func TestNotifierKeepsAFailedAlertPendingForTheNextPass(t *testing.T) {
	store := newFakeStore(Stored{Ref: eventRef, Alert: Raise(Alert{}, t0), Content: eventContent})
	mailer := &fakeMailer{err: errors.New("email: admin alert mail is not configured: resend.admin-to unset")}
	n := NewNotifier(store, mailer, settings, fixedClock(t0), tokens("tok"))

	report, err := n.Pass(context.Background(), HourlyPass)
	if err != nil {
		t.Fatal(err)
	}
	if report != (Report{Failed: 1}) {
		t.Errorf("report = %+v, want 1 failed", report)
	}
	want := Alert{State: Pending, Attempts: 1, LastError: mailer.err.Error(), NextAttemptAt: t0.Add(hour)}
	if got := store.get(eventRef); got != want {
		t.Errorf("alert = %+v, want %+v", got, want)
	}
}

func TestNotifierHourlyPassWaitsForTheNextAttemptButStartupDoesNot(t *testing.T) {
	failed := Alert{State: Pending, Attempts: 1, LastError: "resend returned status 500", NextAttemptAt: t0.Add(hour)}
	now := t0.Add(10 * time.Minute)

	t.Run("hourly", func(t *testing.T) {
		store := newFakeStore(Stored{Ref: eventRef, Alert: failed, Content: eventContent})
		mailer := &fakeMailer{}
		report, err := NewNotifier(store, mailer, settings, fixedClock(now), tokens("tok")).Pass(context.Background(), HourlyPass)
		if err != nil {
			t.Fatal(err)
		}
		if mailer.count() != 0 || report != (Report{}) {
			t.Errorf("hourly pass sent %d mails (report %+v), want none before the next attempt", mailer.count(), report)
		}
		if got := store.get(eventRef); got != failed {
			t.Errorf("alert = %+v, want it untouched", got)
		}
	})
	t.Run("startup", func(t *testing.T) {
		store := newFakeStore(Stored{Ref: eventRef, Alert: failed, Content: eventContent})
		mailer := &fakeMailer{}
		if _, err := NewNotifier(store, mailer, settings, fixedClock(now), tokens("tok")).Pass(context.Background(), StartupPass); err != nil {
			t.Fatal(err)
		}
		if mailer.count() != 1 || store.get(eventRef).State != Sent {
			t.Errorf("startup pass sent %d mails, state %q; want the failed alert sent at once", mailer.count(), store.get(eventRef).State)
		}
	})
}

func TestNotifierLeavesAnAlertUnderAnotherNotifiersLiveClaim(t *testing.T) {
	claimed := Alert{State: Pending, NextAttemptAt: t0, ClaimToken: "other", ClaimExpiresAt: t0.Add(lease)}
	store := newFakeStore(Stored{Ref: eventRef, Alert: claimed, Content: eventContent})
	mailer := &fakeMailer{}

	if _, err := NewNotifier(store, mailer, settings, fixedClock(t0.Add(time.Minute)), tokens("tok")).Pass(context.Background(), StartupPass); err != nil {
		t.Fatal(err)
	}
	if mailer.count() != 0 {
		t.Errorf("sent %d mails, want none under another notifier's live claim", mailer.count())
	}
	if got := store.get(eventRef); got != claimed {
		t.Errorf("alert = %+v, want it untouched", got)
	}
}

func TestNotifierRecoversAnAlertWhoseClaimExpired(t *testing.T) {
	crashed := Alert{State: Pending, NextAttemptAt: t0, ClaimToken: "crashed", ClaimExpiresAt: t0.Add(lease)}
	store := newFakeStore(Stored{Ref: eventRef, Alert: crashed, Content: eventContent})
	mailer := &fakeMailer{}

	if _, err := NewNotifier(store, mailer, settings, fixedClock(t0.Add(lease)), tokens("tok")).Pass(context.Background(), HourlyPass); err != nil {
		t.Fatal(err)
	}
	if mailer.count() != 1 || store.get(eventRef).State != Sent {
		t.Errorf("sent %d mails, state %q; want the crashed notifier's alert sent", mailer.count(), store.get(eventRef).State)
	}
}

func TestNotifierSavesItsClaimBeforeSending(t *testing.T) {
	store := newFakeStore(Stored{Ref: eventRef, Alert: Raise(Alert{}, t0), Content: eventContent})
	var atSend Alert
	mailer := &fakeMailer{send: func(context.Context) error {
		atSend = store.get(eventRef)
		return nil
	}}

	if _, err := NewNotifier(store, mailer, settings, fixedClock(t0), tokens("tok")).Pass(context.Background(), HourlyPass); err != nil {
		t.Fatal(err)
	}
	want := Alert{State: Pending, NextAttemptAt: t0, ClaimToken: "tok_1", ClaimExpiresAt: t0.Add(lease)}
	if atSend != want {
		t.Errorf("stored alert during the send = %+v, want the saved claim %+v", atSend, want)
	}
}

func TestNotifierDoesNotSendWhenAnotherNotifierWinsTheClaim(t *testing.T) {
	store := newFakeStore(Stored{Ref: eventRef, Alert: Raise(Alert{}, t0), Content: eventContent})
	store.saveErr[eventRef] = ErrStaleClaim
	mailer := &fakeMailer{}

	report, err := NewNotifier(store, mailer, settings, fixedClock(t0), tokens("tok")).Pass(context.Background(), HourlyPass)
	if err != nil {
		t.Fatalf("losing a claim race is not an error: %v", err)
	}
	if mailer.count() != 0 || report != (Report{}) {
		t.Errorf("sent %d mails (report %+v), want none after losing the claim", mailer.count(), report)
	}
}

func TestNotifierGivesTheSendItsTimeoutAndRecordsTheOutcomeAfterIt(t *testing.T) {
	store := newFakeStore(Stored{Ref: eventRef, Alert: Raise(Alert{}, t0), Content: eventContent})
	var deadline time.Time
	mailer := &fakeMailer{send: func(ctx context.Context) error {
		deadline, _ = ctx.Deadline()
		<-ctx.Done()
		return ctx.Err()
	}}
	short := settings
	short.Timeout = 10 * time.Millisecond

	start := time.Now()
	report, err := NewNotifier(store, mailer, short, fixedClock(t0), tokens("tok")).Pass(context.Background(), HourlyPass)
	if err != nil {
		t.Fatal(err)
	}
	if deadline.IsZero() || deadline.Sub(start) > time.Second {
		t.Errorf("send deadline = %v, want about %v from the start", deadline, short.Timeout)
	}
	if report != (Report{Failed: 1}) {
		t.Errorf("report = %+v, want 1 failed", report)
	}
	got := store.get(eventRef)
	if got.State != Pending || got.Attempts != 1 || got.LastError != context.DeadlineExceeded.Error() {
		t.Errorf("alert = %+v, want pending with the timeout recorded", got)
	}
}

func TestNotifierReportsStorageFailures(t *testing.T) {
	t.Run("listing", func(t *testing.T) {
		store := newFakeStore()
		store.listErr = errors.New("db down")
		if _, err := NewNotifier(store, &fakeMailer{}, settings, fixedClock(t0), tokens("tok")).Pass(context.Background(), HourlyPass); !errors.Is(err, store.listErr) {
			t.Errorf("err = %v, want the listing error", err)
		}
	})
	t.Run("one alert's save does not stop the others", func(t *testing.T) {
		store := newFakeStore(
			Stored{Ref: eventRef, Alert: Raise(Alert{}, t0), Content: eventContent},
			Stored{Ref: conflictRef, Alert: Raise(Alert{}, t0), Content: conflictContent},
		)
		saveErr := errors.New("db down")
		store.saveErr[eventRef] = saveErr
		mailer := &fakeMailer{}

		report, err := NewNotifier(store, mailer, settings, fixedClock(t0), tokens("tok")).Pass(context.Background(), HourlyPass)
		if !errors.Is(err, saveErr) {
			t.Errorf("err = %v, want the save error", err)
		}
		if report != (Report{Sent: 1}) || store.get(conflictRef).State != Sent {
			t.Errorf("report = %+v, conflict alert %q; want the conflict alert sent", report, store.get(conflictRef).State)
		}
	})
}

func TestParallelNotifiersSendEachAlertOnce(t *testing.T) {
	var stored []Stored
	for i := range 20 {
		stored = append(stored, Stored{Ref: Ref{Kind: EventAttentionAlert, ID: fmt.Sprintf("evt_%d", i)}, Alert: Raise(Alert{}, t0), Content: eventContent})
	}
	store := newFakeStore(stored...)
	mailer := &fakeMailer{}

	var wg sync.WaitGroup
	for i := range 4 {
		n := NewNotifier(store, mailer, settings, fixedClock(t0), tokens(fmt.Sprintf("n%d", i)))
		wg.Go(func() {
			if _, err := n.Pass(context.Background(), StartupPass); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()

	if mailer.count() != 20 {
		t.Errorf("sent %d mails, want each of the 20 alerts once", mailer.count())
	}
}

func TestNotifierRunsAStartupPassThenAnHourlyPassPerTick(t *testing.T) {
	failed := Alert{State: Pending, Attempts: 1, NextAttemptAt: t0.Add(hour)}
	store := newFakeStore(Stored{Ref: eventRef, Alert: failed, Content: eventContent})
	mailer := &fakeMailer{err: errors.New("resend returned status 500")}
	clock := t0
	var mu sync.Mutex
	now := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return clock
	}
	n := NewNotifier(store, mailer, settings, now, tokens("tok"))

	ctx, cancel := context.WithCancel(context.Background())
	ticks := make(chan time.Time)
	passes := make(chan Report)
	done := make(chan struct{})
	go func() {
		n.Run(ctx, ticks, func(r Report, err error) {
			if err != nil {
				t.Error(err)
			}
			passes <- r
		})
		close(done)
	}()

	if r := <-passes; r != (Report{Failed: 1}) {
		t.Errorf("startup pass = %+v, want the not-yet-due alert retried", r)
	}

	ticks <- t0
	if r := <-passes; r != (Report{}) {
		t.Errorf("hourly pass before the next attempt = %+v, want nothing", r)
	}

	mu.Lock()
	clock = t0.Add(2 * hour)
	mu.Unlock()
	mailer.mu.Lock()
	mailer.err = nil
	mailer.mu.Unlock()
	ticks <- clock
	if r := <-passes; r != (Report{Sent: 1}) {
		t.Errorf("hourly pass at the next attempt = %+v, want 1 sent", r)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run did not stop when its context was cancelled")
	}
}
