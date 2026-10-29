package account

import (
	"context"
	"fmt"
	"strings"

	"enx-api/billing/eligibility"
)

// Service holds the account rules.
type Service struct {
	users    Users
	grants   TrialGrants
	clerk    Clerk
	subs     Subscriptions
	deletion DeletionChecker
	admins   Admins
	hasher   Hasher
	now      Clock
}

// NewService builds the service. clerk is nil when CLERK_SECRET_KEY is not
// set: every action then fails with ErrNotConfigured and changes nothing.
func NewService(users Users, grants TrialGrants, clerk Clerk, subs Subscriptions, admins Admins,
	hasher Hasher, now Clock) *Service {
	return &Service{users: users, grants: grants, clerk: clerk, subs: subs, admins: admins, hasher: hasher, now: now}
}

// WithDeletionChecker selects the cutover deletion check.
func (s *Service) WithDeletionChecker(checker DeletionChecker) *Service {
	s.deletion = checker
	return s
}

// DeleteOptions are the admin's choices for a deletion.
type DeleteOptions struct {
	// ResetTrial also clears the email's trial grant record, so the email
	// signs up again as a brand-new user (ADR-062 Decision 4). Test
	// accounts only.
	ResetTrial bool
}

// DeleteOwn is the user deleting their own account, confirmed by typing
// their email.
func (s *Service) DeleteOwn(ctx context.Context, userID, confirmEmail string) error {
	u, err := s.target(ctx, userID)
	if err != nil {
		return err
	}
	if normalizeEmail(confirmEmail) != normalizeEmail(u.Email) {
		return ErrEmailMismatch
	}
	return s.delete(ctx, u, DeleteOptions{})
}

// Delete is the admin deleting an account.
func (s *Service) Delete(ctx context.Context, userID string, opts DeleteOptions) error {
	u, err := s.target(ctx, userID)
	if err != nil {
		return err
	}
	return s.delete(ctx, u, opts)
}

// delete runs ADR-062 Decision 2's order: the trial grant record first
// (idempotent), then Clerk, then the local data in one transaction. A Clerk
// failure leaves the local data as it was; a failed local delete is retried
// by the admin, Clerk then answering "already gone".
func (s *Service) delete(ctx context.Context, u User, opts DeleteOptions) error {
	if s.admins.Contains(u.ClerkUserID) {
		return ErrProtectedAdmin
	}
	var err error
	if s.deletion != nil {
		verdict, checkErr := s.deletion.Check(ctx, u.ID)
		if checkErr != nil {
			return fmt.Errorf("account: check the subscription: %w", checkErr)
		}
		switch verdict {
		case eligibility.DeletionAllowed:
		case eligibility.DeletionBlockedOpenConflict:
			return ErrSubscriptionConflict
		case eligibility.DeletionBlockedRenewing:
			return ErrRenewingSubscription
		default:
			return fmt.Errorf("account: subscription live state unknown")
		}
	} else {
		renewing, checkErr := s.subs.Renewing(ctx, u.ID)
		if checkErr != nil {
			return fmt.Errorf("account: check the subscription: %w", checkErr)
		}
		if renewing {
			return ErrRenewingSubscription
		}
	}

	if h := s.hasher.Of(u.Email); h != "" {
		if opts.ResetTrial {
			err = s.grants.Delete(ctx, h)
		} else {
			err = s.grants.Record(ctx, h, u.ID, s.now())
		}
		if err != nil {
			return fmt.Errorf("account: trial grant record: %w", err)
		}
	}

	if err := s.clerk.DeleteUser(ctx, u.ClerkUserID); err != nil {
		return fmt.Errorf("account: delete the Clerk user: %w", err)
	}
	if err := s.users.DeleteData(ctx, u.ID); err != nil {
		return fmt.Errorf("account: delete the local data: %w", err)
	}
	return nil
}

// Disable blocks the account: enx-api rejects it at once, and Clerk bans it
// so it is signed out and cannot sign in again. The local status is set
// first, so a failed Clerk call still leaves the account blocked.
func (s *Service) Disable(ctx context.Context, userID string) error {
	u, err := s.target(ctx, userID)
	if err != nil {
		return err
	}
	if s.admins.Contains(u.ClerkUserID) {
		return ErrProtectedAdmin
	}
	if err := s.users.SetStatus(ctx, u.ID, StatusDisabled); err != nil {
		return err
	}
	if err := s.clerk.BanUser(ctx, u.ClerkUserID); err != nil {
		return fmt.Errorf("account: disabled locally, but the Clerk ban failed: %w", err)
	}
	return nil
}

// Enable lifts a Disable: Clerk unban, then the local status back to active.
func (s *Service) Enable(ctx context.Context, userID string) error {
	u, err := s.target(ctx, userID)
	if err != nil {
		return err
	}
	if err := s.clerk.UnbanUser(ctx, u.ClerkUserID); err != nil {
		return fmt.Errorf("account: Clerk unban: %w", err)
	}
	return s.users.SetStatus(ctx, u.ID, StatusActive)
}

// RevokeSessions signs the user out on every device; the account stays as
// it is and they can sign in again (ADR-062 Decision 6).
func (s *Service) RevokeSessions(ctx context.Context, userID string) error {
	u, err := s.target(ctx, userID)
	if err != nil {
		return err
	}
	if err := s.clerk.RevokeSessions(ctx, u.ClerkUserID); err != nil {
		return fmt.Errorf("account: revoke sessions: %w", err)
	}
	return nil
}

// target loads the user an action is for, after checking Clerk is there.
func (s *Service) target(ctx context.Context, userID string) (User, error) {
	if s.clerk == nil {
		return User{}, ErrNotConfigured
	}
	u, ok, err := s.users.Get(ctx, userID)
	if err != nil {
		return User{}, err
	}
	if !ok {
		return User{}, ErrUserNotFound
	}
	return u, nil
}

func normalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }
