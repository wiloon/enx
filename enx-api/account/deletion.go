package account

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// ErrDeletionInProgress is retryable: another owner holds the attempt, or
// billing changed during eligibility checking.
var ErrDeletionInProgress = errors.New("account: deletion in progress; retry")

// DeletionAttempt is a fenced, durable attempt. Irreversible means Clerk
// may already have been invoked, even when the process died before calling it.
type DeletionAttempt struct {
	UserID       string
	Owner        string
	Revision     int64
	Irreversible bool
}

// DeletionCoordinator serializes deletion with billing. Prepare atomically
// revalidates the revision, records the original trial intent and enters the
// irreversible phase. Complete deletes local data and retains the deleted gate.
// Every mutation rejects an expired or replaced owner. No external I/O occurs
// within these operations.
type DeletionCoordinator interface {
	Acquire(context.Context, User, DeleteOptions, time.Time) (DeletionAttempt, error)
	Prepare(context.Context, DeletionAttempt, string, time.Time) error
	Release(context.Context, DeletionAttempt, time.Time) error
	Complete(context.Context, DeletionAttempt, time.Time) error
}

func (s *Service) WithDeletionCoordinator(coordinator DeletionCoordinator) *Service {
	s.coordinator = coordinator
	return s
}

func (s *Service) coordinatedDelete(ctx context.Context, u User, opts DeleteOptions) error {
	a, err := s.coordinator.Acquire(ctx, u, opts, s.now())
	if err != nil {
		return err
	}
	if !a.Irreversible {
		err = s.checkDeletion(ctx, u.ID)
		if err == nil {
			err = s.coordinator.Prepare(ctx, a, s.hasher.Of(u.Email), s.now())
		}
		if err != nil {
			// Cancellation must not prevent a reversible attempt from releasing its
			// fence. Release itself still checks ownership and phase in the database.
			releaseErr := s.coordinator.Release(context.WithoutCancel(ctx), a, s.now())
			return errors.Join(err, releaseErr)
		}
	}
	// An error is conservatively uncertain. Retain the gate and recover only
	// toward completion; never interpret a timeout as proof of non-deletion.
	if err := s.clerk.DeleteUser(ctx, u.ClerkUserID); err != nil {
		return fmt.Errorf("account: delete the Clerk user: %w", err)
	}
	return s.coordinator.Complete(ctx, a, s.now())
}
