// Package account is account deletion, disabling and signing users out
// (ADR-062). One Delete serves both the user's own deletion and the admin's.
//
// The rules live in Service. The users table, the trial grant record, Clerk
// and Stripe come in through the interfaces below, so the rules run in unit
// tests on fakes.
package account

import (
	"context"
	"errors"
	"time"
)

// Status is a users.status value.
type Status string

const (
	StatusActive Status = "active"
	// StatusDisabled: the admin disabled the account; enx-api rejects its
	// requests with account_disabled and Clerk has banned it.
	StatusDisabled Status = "disabled"
)

// User is what the account rules need to know about a local user.
type User struct {
	ID          string
	ClerkUserID string
	Email       string
	Status      Status
}

var (
	ErrUserNotFound = errors.New("account: no such user")
	// ErrNotConfigured: CLERK_SECRET_KEY is not set, so Clerk cannot be
	// told to delete, ban or sign out anyone.
	ErrNotConfigured = errors.New("account: Clerk Backend API is not configured")
	// ErrProtectedAdmin: the account is in ADMIN_CLERK_USER_IDS, which can
	// be neither disabled nor deleted (ADR-062 Decision 7).
	ErrProtectedAdmin = errors.New("account: an admin account cannot be disabled or deleted")
	// ErrRenewingSubscription: the user has a subscription that will renew;
	// it must be canceled first (ADR-062 Decision 2).
	ErrRenewingSubscription = errors.New("account: cancel the subscription before deleting the account")
	// ErrEmailMismatch: the user's own deletion was confirmed with an email
	// that is not theirs.
	ErrEmailMismatch = errors.New("account: the confirmation email does not match")
)

// Users is the users table and everything stored under a user id.
type Users interface {
	Get(ctx context.Context, userID string) (User, bool, error)
	SetStatus(ctx context.Context, userID string, status Status) error
	// DeleteData deletes, in one transaction, the user's row and every row
	// stored under their id, except the ledger: credit_transactions,
	// subscriptions and referrals stay.
	DeleteData(ctx context.Context, userID string) error
}

// TrialGrants is the trial grant record (ADR-062 Decision 3), keyed by the
// email HMAC.
type TrialGrants interface {
	// Record notes that the email was granted a trial by userID; a record
	// already there is kept as it is.
	Record(ctx context.Context, emailHMAC, userID string, at time.Time) error
	Delete(ctx context.Context, emailHMAC string) error
}

// Clerk is the Clerk Backend API.
type Clerk interface {
	// DeleteUser deletes the Clerk user and with it all their sessions. A
	// user Clerk no longer has counts as deleted.
	DeleteUser(ctx context.Context, clerkUserID string) error
	// BanUser signs the user out everywhere and stops them signing in.
	BanUser(ctx context.Context, clerkUserID string) error
	UnbanUser(ctx context.Context, clerkUserID string) error
	// RevokeSessions signs the user out on every device.
	RevokeSessions(ctx context.Context, clerkUserID string) error
}

// Subscriptions answers whether a user's subscription will renew.
type Subscriptions interface {
	Renewing(ctx context.Context, userID string) (bool, error)
}

// Admins is the ADMIN_CLERK_USER_IDS allowlist.
type Admins interface {
	Contains(clerkUserID string) bool
}

// Hasher is the email HMAC; "" means it cannot be computed.
type Hasher interface {
	Of(email string) string
}

// Clock is the service's time source.
type Clock func() time.Time
