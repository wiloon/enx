package account

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"enx-api/billing/eligibility"
)

// fakeCoordinator records the fence operations in order. Each err fails
// its operation; attempt is what Acquire hands out.
type fakeCoordinator struct {
	attempt DeletionAttempt
	calls   []string

	preparedHMAC  string
	releaseCtxErr error

	acquireErr, prepareErr, releaseErr, completeErr error
}

func (f *fakeCoordinator) Acquire(_ context.Context, u User, _ DeleteOptions, _ time.Time) (DeletionAttempt, error) {
	f.calls = append(f.calls, "acquire")
	if f.acquireErr != nil {
		return DeletionAttempt{}, f.acquireErr
	}
	a := f.attempt
	a.UserID = u.ID
	return a, nil
}

func (f *fakeCoordinator) Prepare(_ context.Context, _ DeletionAttempt, emailHMAC string, _ time.Time) error {
	f.calls = append(f.calls, "prepare")
	f.preparedHMAC = emailHMAC
	return f.prepareErr
}

func (f *fakeCoordinator) Release(ctx context.Context, _ DeletionAttempt, _ time.Time) error {
	f.calls = append(f.calls, "release")
	f.releaseCtxErr = ctx.Err()
	return f.releaseErr
}

func (f *fakeCoordinator) Complete(_ context.Context, _ DeletionAttempt, _ time.Time) error {
	f.calls = append(f.calls, "complete")
	return f.completeErr
}

type fakeDeletionChecker struct {
	verdict eligibility.DeletionVerdict
	err     error
}

func (f fakeDeletionChecker) Check(context.Context, string) (eligibility.DeletionVerdict, error) {
	return f.verdict, f.err
}

func newCoordinatedEnv(c *fakeCoordinator, checker DeletionChecker) *env {
	e := newEnv(alice)
	e.svc.WithDeletionCoordinator(c)
	if checker != nil {
		e.svc.WithDeletionChecker(checker)
	}
	return e
}

func TestCoordinatedDeleteFencesClerkBetweenPrepareAndComplete(t *testing.T) {
	c := &fakeCoordinator{}
	e := newCoordinatedEnv(c, fakeDeletionChecker{verdict: eligibility.DeletionAllowed})

	if err := e.svc.DeleteOwn(context.Background(), alice.ID, alice.Email); err != nil {
		t.Fatalf("DeleteOwn: %v", err)
	}
	if want := []string{"acquire", "prepare", "complete"}; !reflect.DeepEqual(c.calls, want) {
		t.Fatalf("coordinator calls = %v, want %v", c.calls, want)
	}
	if c.preparedHMAC != hmacOf(alice.Email) {
		t.Fatalf("Prepare got email HMAC %q, want %q", c.preparedHMAC, hmacOf(alice.Email))
	}
	if !reflect.DeepEqual(e.clerk.deleted, []string{alice.ClerkUserID}) {
		t.Fatalf("Clerk deletes = %v, want [%s]", e.clerk.deleted, alice.ClerkUserID)
	}
}

func TestCoordinatedDeleteRefusedByBillingReleasesTheFence(t *testing.T) {
	for name, tc := range map[string]struct {
		verdict eligibility.DeletionVerdict
		want    error
	}{
		"renewing":      {eligibility.DeletionBlockedRenewing, ErrRenewingSubscription},
		"open conflict": {eligibility.DeletionBlockedOpenConflict, ErrSubscriptionConflict},
	} {
		t.Run(name, func(t *testing.T) {
			c := &fakeCoordinator{}
			e := newCoordinatedEnv(c, fakeDeletionChecker{verdict: tc.verdict})

			err := e.svc.Delete(context.Background(), alice.ID, DeleteOptions{})
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if want := []string{"acquire", "release"}; !reflect.DeepEqual(c.calls, want) {
				t.Fatalf("coordinator calls = %v, want %v", c.calls, want)
			}
			if len(e.clerk.deleted) != 0 {
				t.Fatalf("Clerk must not be called: %v", e.clerk.deleted)
			}
		})
	}
}

func TestCoordinatedDeleteReleasesEvenWhenTheRequestIsCanceled(t *testing.T) {
	prepareErr := errors.New("revision changed")
	c := &fakeCoordinator{prepareErr: prepareErr}
	e := newCoordinatedEnv(c, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := e.svc.Delete(ctx, alice.ID, DeleteOptions{})
	if !errors.Is(err, prepareErr) {
		t.Fatalf("err = %v, want the Prepare error", err)
	}
	if want := []string{"acquire", "prepare", "release"}; !reflect.DeepEqual(c.calls, want) {
		t.Fatalf("coordinator calls = %v, want %v", c.calls, want)
	}
	if c.releaseCtxErr != nil {
		t.Fatalf("Release ran on a canceled context: %v", c.releaseCtxErr)
	}
}

func TestCoordinatedDeleteReportsBothTheRefusalAndAFailedRelease(t *testing.T) {
	releaseErr := errors.New("fence lost")
	c := &fakeCoordinator{releaseErr: releaseErr}
	e := newCoordinatedEnv(c, nil)
	e.subs[alice.ID] = true

	err := e.svc.Delete(context.Background(), alice.ID, DeleteOptions{})
	if !errors.Is(err, ErrRenewingSubscription) || !errors.Is(err, releaseErr) {
		t.Fatalf("err = %v, want both ErrRenewingSubscription and the Release error", err)
	}
}

func TestCoordinatedDeleteResumesAnIrreversibleAttemptWithoutRecheckingBilling(t *testing.T) {
	c := &fakeCoordinator{attempt: DeletionAttempt{Irreversible: true}}
	e := newCoordinatedEnv(c, fakeDeletionChecker{verdict: eligibility.DeletionBlockedRenewing})

	if err := e.svc.Delete(context.Background(), alice.ID, DeleteOptions{}); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if want := []string{"acquire", "complete"}; !reflect.DeepEqual(c.calls, want) {
		t.Fatalf("coordinator calls = %v, want %v", c.calls, want)
	}
	if !reflect.DeepEqual(e.clerk.deleted, []string{alice.ClerkUserID}) {
		t.Fatalf("Clerk deletes = %v, want [%s]", e.clerk.deleted, alice.ClerkUserID)
	}
}

func TestCoordinatedDeleteKeepsTheGateWhenClerkFails(t *testing.T) {
	c := &fakeCoordinator{}
	e := newCoordinatedEnv(c, nil)
	e.clerk.err = errClerkDown

	err := e.svc.Delete(context.Background(), alice.ID, DeleteOptions{})
	if !errors.Is(err, errClerkDown) {
		t.Fatalf("err = %v, want the Clerk error", err)
	}
	if want := []string{"acquire", "prepare"}; !reflect.DeepEqual(c.calls, want) {
		t.Fatalf("coordinator calls = %v, want %v: neither released nor completed", c.calls, want)
	}
}

func TestCoordinatedDeleteStopsWhenAnotherAttemptHoldsTheFence(t *testing.T) {
	c := &fakeCoordinator{acquireErr: ErrDeletionInProgress}
	e := newCoordinatedEnv(c, nil)

	err := e.svc.Delete(context.Background(), alice.ID, DeleteOptions{})
	if !errors.Is(err, ErrDeletionInProgress) {
		t.Fatalf("err = %v, want ErrDeletionInProgress", err)
	}
	if want := []string{"acquire"}; !reflect.DeepEqual(c.calls, want) {
		t.Fatalf("coordinator calls = %v, want %v", c.calls, want)
	}
	if len(e.clerk.deleted) != 0 {
		t.Fatalf("Clerk must not be called: %v", e.clerk.deleted)
	}
}

func TestDeleteRefusesWhenBillingCannotBeChecked(t *testing.T) {
	for name, checker := range map[string]DeletionChecker{
		"checker error":       fakeDeletionChecker{err: errors.New("db down")},
		"live state unknown":  fakeDeletionChecker{verdict: eligibility.DeletionBlockedLookup},
		"renewing read error": nil,
	} {
		t.Run(name, func(t *testing.T) {
			e := newEnv(alice)
			if checker != nil {
				e.svc.WithDeletionChecker(checker)
			} else {
				e.svc.subs = failingSubscriptions{}
			}

			if err := e.svc.Delete(context.Background(), alice.ID, DeleteOptions{}); err == nil {
				t.Fatal("Delete succeeded, want a refusal")
			}
			if _, ok := e.store.users[alice.ID]; !ok || len(e.clerk.deleted) != 0 {
				t.Fatal("a refused deletion must change nothing")
			}
		})
	}
}

func TestDeleteWithACheckerFollowsItsVerdictNotTheRenewingFlag(t *testing.T) {
	e := newEnv(alice)
	e.subs[alice.ID] = true
	e.svc.WithDeletionChecker(fakeDeletionChecker{verdict: eligibility.DeletionBlockedOpenConflict})

	err := e.svc.Delete(context.Background(), alice.ID, DeleteOptions{})
	if !errors.Is(err, ErrSubscriptionConflict) {
		t.Fatalf("err = %v, want ErrSubscriptionConflict", err)
	}
}

type failingSubscriptions struct{}

func (failingSubscriptions) Renewing(context.Context, string) (bool, error) {
	return false, errors.New("stripe down")
}
