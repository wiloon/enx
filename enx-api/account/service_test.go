package account

import (
	"context"
	"errors"
	"testing"
	"time"
)

var (
	alice = User{ID: "u-alice", ClerkUserID: "user_alice", Email: "Alice@example.com", Status: StatusActive}
	admin = User{ID: "u-admin", ClerkUserID: "user_admin", Email: "admin@example.com", Status: StatusActive}
)

type env struct {
	store *fakeStore
	clerk *fakeClerk
	subs  fakeSubscriptions
	svc   *Service
}

func newEnv(users ...User) *env {
	e := &env{store: newFakeStore(users...), clerk: &fakeClerk{}, subs: fakeSubscriptions{}}
	e.svc = NewService(e.store, e.store, e.clerk, e.subs, fakeAdmins{admin.ClerkUserID},
		NewEmailHMAC("test-key"), func() time.Time { return testNow })
	return e
}

func hmacOf(email string) string { return NewEmailHMAC("test-key").Of(email) }

func TestDeleteOwnRemovesTheUserDataAndTheClerkUserButKeepsTheLedger(t *testing.T) {
	e := newEnv(alice)
	if err := e.svc.DeleteOwn(context.Background(), alice.ID, " alice@EXAMPLE.com "); err != nil {
		t.Fatalf("DeleteOwn: %v", err)
	}
	if _, ok := e.store.users[alice.ID]; ok || len(e.store.data[alice.ID]) != 0 {
		t.Fatalf("user data left behind: users=%v data=%v", e.store.users, e.store.data)
	}
	if len(e.store.ledger[alice.ID]) != 2 {
		t.Fatalf("ledger rows must stay: %v", e.store.ledger[alice.ID])
	}
	if len(e.clerk.deleted) != 1 || e.clerk.deleted[0] != alice.ClerkUserID {
		t.Fatalf("Clerk deletes = %v, want [%s]", e.clerk.deleted, alice.ClerkUserID)
	}
}

func TestDeleteRecordsTheTrialGrantSoTheEmailGetsNoSecondTrial(t *testing.T) {
	e := newEnv(alice)
	if err := e.svc.DeleteOwn(context.Background(), alice.ID, alice.Email); err != nil {
		t.Fatalf("DeleteOwn: %v", err)
	}
	if got := e.store.grants[hmacOf(alice.Email)]; got != alice.ID {
		t.Fatalf("trial grant record = %q, want %q", got, alice.ID)
	}
}

func TestDeleteKeepsAnEarlierTrialGrantRecord(t *testing.T) {
	e := newEnv(alice)
	e.store.grants[hmacOf(alice.Email)] = "u-alice-before"
	if err := e.svc.Delete(context.Background(), alice.ID, DeleteOptions{}); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if got := e.store.grants[hmacOf(alice.Email)]; got != "u-alice-before" {
		t.Fatalf("trial grant record = %q, want the earlier one kept", got)
	}
}

func TestAdminDeleteWithResetTrialClearsTheTrialGrantRecord(t *testing.T) {
	e := newEnv(alice)
	e.store.grants[hmacOf(alice.Email)] = alice.ID
	if err := e.svc.Delete(context.Background(), alice.ID, DeleteOptions{ResetTrial: true}); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, ok := e.store.grants[hmacOf(alice.Email)]; ok {
		t.Fatalf("resetTrial must clear the record: %v", e.store.grants)
	}
	if _, ok := e.store.users[alice.ID]; ok {
		t.Fatal("the user must still be deleted")
	}
}

func TestDeleteOwnRefusesAnEmailThatIsNotTheirs(t *testing.T) {
	e := newEnv(alice)
	err := e.svc.DeleteOwn(context.Background(), alice.ID, "bob@example.com")
	if !errors.Is(err, ErrEmailMismatch) {
		t.Fatalf("err = %v, want ErrEmailMismatch", err)
	}
	if _, ok := e.store.users[alice.ID]; !ok || len(e.clerk.deleted) != 0 {
		t.Fatal("a refused deletion must change nothing")
	}
}

func TestDeleteRefusesARenewingSubscription(t *testing.T) {
	for name, del := range map[string]func(*env) error{
		"own":   func(e *env) error { return e.svc.DeleteOwn(context.Background(), alice.ID, alice.Email) },
		"admin": func(e *env) error { return e.svc.Delete(context.Background(), alice.ID, DeleteOptions{}) },
	} {
		t.Run(name, func(t *testing.T) {
			e := newEnv(alice)
			e.subs[alice.ID] = true
			if err := del(e); !errors.Is(err, ErrRenewingSubscription) {
				t.Fatalf("err = %v, want ErrRenewingSubscription", err)
			}
			if _, ok := e.store.users[alice.ID]; !ok || len(e.clerk.deleted) != 0 || len(e.store.grants) != 0 {
				t.Fatal("a refused deletion must change nothing")
			}
		})
	}
}

func TestDeleteLeavesLocalDataWhenClerkFails(t *testing.T) {
	e := newEnv(alice)
	e.clerk.err = errClerkDown
	if err := e.svc.Delete(context.Background(), alice.ID, DeleteOptions{}); !errors.Is(err, errClerkDown) {
		t.Fatalf("err = %v, want the Clerk error", err)
	}
	if _, ok := e.store.users[alice.ID]; !ok || len(e.store.data[alice.ID]) == 0 {
		t.Fatal("local data must be untouched when Clerk fails")
	}
}

func TestProtectedAdminCannotBeDeletedOrDisabled(t *testing.T) {
	for name, act := range map[string]func(*env) error{
		"own delete":   func(e *env) error { return e.svc.DeleteOwn(context.Background(), admin.ID, admin.Email) },
		"admin delete": func(e *env) error { return e.svc.Delete(context.Background(), admin.ID, DeleteOptions{}) },
		"disable":      func(e *env) error { return e.svc.Disable(context.Background(), admin.ID) },
	} {
		t.Run(name, func(t *testing.T) {
			e := newEnv(admin)
			if err := act(e); !errors.Is(err, ErrProtectedAdmin) {
				t.Fatalf("err = %v, want ErrProtectedAdmin", err)
			}
			if u := e.store.users[admin.ID]; u.Status != StatusActive || len(e.clerk.deleted)+len(e.clerk.banned) != 0 {
				t.Fatal("a refused action must change nothing")
			}
		})
	}
}

func TestDisableMarksTheUserDisabledAndBansThemInClerk(t *testing.T) {
	e := newEnv(alice)
	if err := e.svc.Disable(context.Background(), alice.ID); err != nil {
		t.Fatalf("Disable: %v", err)
	}
	if e.store.users[alice.ID].Status != StatusDisabled {
		t.Fatalf("status = %q, want disabled", e.store.users[alice.ID].Status)
	}
	if len(e.clerk.banned) != 1 || e.clerk.banned[0] != alice.ClerkUserID {
		t.Fatalf("bans = %v", e.clerk.banned)
	}
}

func TestDisableStillBlocksLocallyWhenTheClerkBanFails(t *testing.T) {
	e := newEnv(alice)
	e.clerk.err = errClerkDown
	if err := e.svc.Disable(context.Background(), alice.ID); !errors.Is(err, errClerkDown) {
		t.Fatalf("err = %v, want the Clerk error", err)
	}
	if e.store.users[alice.ID].Status != StatusDisabled {
		t.Fatal("enx-api must reject the user even when the Clerk ban failed")
	}
}

func TestEnableUnbansAndReactivates(t *testing.T) {
	disabled := alice
	disabled.Status = StatusDisabled
	e := newEnv(disabled)
	if err := e.svc.Enable(context.Background(), alice.ID); err != nil {
		t.Fatalf("Enable: %v", err)
	}
	if e.store.users[alice.ID].Status != StatusActive || len(e.clerk.unbanned) != 1 {
		t.Fatalf("status=%q unbans=%v", e.store.users[alice.ID].Status, e.clerk.unbanned)
	}
}

func TestRevokeSessionsSignsOutWithoutChangingTheStatus(t *testing.T) {
	e := newEnv(alice)
	if err := e.svc.RevokeSessions(context.Background(), alice.ID); err != nil {
		t.Fatalf("RevokeSessions: %v", err)
	}
	if len(e.clerk.revoked) != 1 || e.store.users[alice.ID].Status != StatusActive {
		t.Fatalf("revoked=%v status=%q", e.clerk.revoked, e.store.users[alice.ID].Status)
	}
}

func TestActionsOnAMissingUserReportNotFound(t *testing.T) {
	e := newEnv()
	for name, err := range map[string]error{
		"delete":  e.svc.Delete(context.Background(), "nobody", DeleteOptions{}),
		"disable": e.svc.Disable(context.Background(), "nobody"),
		"enable":  e.svc.Enable(context.Background(), "nobody"),
		"revoke":  e.svc.RevokeSessions(context.Background(), "nobody"),
	} {
		if !errors.Is(err, ErrUserNotFound) {
			t.Errorf("%s: err = %v, want ErrUserNotFound", name, err)
		}
	}
}

func TestWithoutClerkEveryActionIsNotConfigured(t *testing.T) {
	store := newFakeStore(alice)
	svc := NewService(store, store, nil, fakeSubscriptions{}, fakeAdmins{}, NewEmailHMAC("k"),
		func() time.Time { return testNow })
	for name, err := range map[string]error{
		"own delete": svc.DeleteOwn(context.Background(), alice.ID, alice.Email),
		"delete":     svc.Delete(context.Background(), alice.ID, DeleteOptions{}),
		"disable":    svc.Disable(context.Background(), alice.ID),
		"enable":     svc.Enable(context.Background(), alice.ID),
		"revoke":     svc.RevokeSessions(context.Background(), alice.ID),
	} {
		if !errors.Is(err, ErrNotConfigured) {
			t.Errorf("%s: err = %v, want ErrNotConfigured", name, err)
		}
	}
	if u := store.users[alice.ID]; u.Status != StatusActive || len(store.grants) != 0 {
		t.Fatal("nothing may change without Clerk")
	}
}
