// Package alert holds the delivery rules and the mail of durable
// administrator alerts (ADR-067 §管理员处理与邮件): an event that needs
// attention, a subscription conflict found, and a user's billing-support
// request each carry one alert with this state. It is pure: the caller
// stores the returned state with a conditional write on the claim token it
// read, and sends the mail outside any database transaction.
//
// Only a provider-confirmed send marks an alert sent. A pending alert is
// never abandoned, however often it fails; the notifier retries it at
// startup and on its hourly pass. A crash after sending but before marking
// may send one duplicate; raising the same alert again never does.
package alert

import (
	"errors"
	"time"
)

// State is an alert's delivery state; "" means no alert was raised.
type State string

const (
	Pending State = "pending"
	Sent    State = "sent"
)

var (
	// ErrNotDue: the alert is sent, not raised, under another notifier's
	// live claim, or (on the hourly pass) not yet at its next attempt.
	ErrNotDue = errors.New("billing/alert: alert is not due")
	// ErrNoToken: a claim needs a nonempty fencing token.
	ErrNoToken = errors.New("billing/alert: claim token is empty")
	// ErrStaleClaim: the caller no longer holds the claim; another notifier
	// took it over, so this one must not record its outcome.
	ErrStaleClaim = errors.New("billing/alert: claim is no longer held")
)

// Alert is one durable alert's delivery state.
type Alert struct {
	State          State
	Attempts       int
	LastError      string
	NextAttemptAt  time.Time
	SentAt         time.Time
	ClaimToken     string
	ClaimExpiresAt time.Time
}

// Pass is which notifier run is looking for due alerts.
type Pass int

const (
	// HourlyPass retries a failed alert only once its next attempt is due.
	HourlyPass Pass = iota
	// StartupPass retries every pending alert not under a live claim, so a
	// restart after fixing the mail configuration sends at once.
	StartupPass
)

// Raise makes a new alert pending and due at now. An alert already pending
// or sent is returned unchanged: redelivery, worker retry and an
// administrator's event retry never reset or resend it.
func Raise(a Alert, now time.Time) Alert {
	if a.State != "" {
		return a
	}
	return Alert{State: Pending, NextAttemptAt: now}
}

// Due reports whether a notifier on pass may claim the alert at now.
func (a Alert) Due(now time.Time, pass Pass) bool {
	if a.State != Pending {
		return false
	}
	if a.ClaimToken != "" && now.Before(a.ClaimExpiresAt) {
		return false
	}
	return pass == StartupPass || !now.Before(a.NextAttemptAt)
}

// Claim gives the alert to the notifier holding token until now+lease. The
// lease must outlast the send timeout.
func Claim(a Alert, token string, now time.Time, lease time.Duration, pass Pass) (Alert, error) {
	if token == "" {
		return a, ErrNoToken
	}
	if !a.Due(now, pass) {
		return a, ErrNotDue
	}
	a.ClaimToken = token
	a.ClaimExpiresAt = now.Add(lease)
	return a, nil
}

// MarkSent records a provider-confirmed send by the claim holder.
func MarkSent(a Alert, token string, now time.Time) (Alert, error) {
	if !holds(a, token) {
		return a, ErrStaleClaim
	}
	return Alert{State: Sent, Attempts: a.Attempts + 1, SentAt: now}, nil
}

// MarkFailed records a failed send by the claim holder: missing mail
// configuration, a provider error or a timeout. The alert stays pending and
// is due again after retryAfter (the notifier's poll interval).
func MarkFailed(a Alert, token string, now time.Time, reason string, retryAfter time.Duration) (Alert, error) {
	if !holds(a, token) {
		return a, ErrStaleClaim
	}
	return Alert{State: Pending, Attempts: a.Attempts + 1, LastError: reason, NextAttemptAt: now.Add(retryAfter)}, nil
}

// holds reports whether token is the alert's current claim. A notifier whose
// lease lapsed still holds the claim until another one takes it over, so a
// confirmed send is recorded rather than repeated.
func holds(a Alert, token string) bool {
	return a.State == Pending && token != "" && a.ClaimToken == token
}
