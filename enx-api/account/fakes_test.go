package account

import (
	"context"
	"errors"
	"time"
)

// fakeStore is Users and TrialGrants in memory. data holds the rows stored
// under each user id; ledger the ones deletion must keep.
type fakeStore struct {
	users  map[string]User
	data   map[string][]string
	ledger map[string][]string
	grants map[string]string // email HMAC -> user id

	deleteErr error
}

func newFakeStore(users ...User) *fakeStore {
	s := &fakeStore{
		users: map[string]User{}, data: map[string][]string{}, ledger: map[string][]string{},
		grants: map[string]string{},
	}
	for _, u := range users {
		s.users[u.ID] = u
		s.data[u.ID] = []string{"user_dicts", "saved_pages", "user_preferences"}
		s.ledger[u.ID] = []string{"credit_transactions", "subscriptions"}
	}
	return s
}

func (s *fakeStore) Get(_ context.Context, userID string) (User, bool, error) {
	u, ok := s.users[userID]
	return u, ok, nil
}

func (s *fakeStore) SetStatus(_ context.Context, userID string, status Status) error {
	u := s.users[userID]
	u.Status = status
	s.users[userID] = u
	return nil
}

func (s *fakeStore) DeleteData(_ context.Context, userID string) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	delete(s.users, userID)
	delete(s.data, userID)
	return nil
}

func (s *fakeStore) Record(_ context.Context, emailHMAC, userID string, _ time.Time) error {
	if _, ok := s.grants[emailHMAC]; !ok {
		s.grants[emailHMAC] = userID
	}
	return nil
}

func (s *fakeStore) Delete(_ context.Context, emailHMAC string) error {
	delete(s.grants, emailHMAC)
	return nil
}

// fakeClerk records what was asked of it; err fails every call.
type fakeClerk struct {
	deleted, banned, unbanned, revoked []string
	err                                error
}

func (c *fakeClerk) DeleteUser(_ context.Context, id string) error {
	if c.err != nil {
		return c.err
	}
	c.deleted = append(c.deleted, id)
	return nil
}

func (c *fakeClerk) BanUser(_ context.Context, id string) error {
	if c.err != nil {
		return c.err
	}
	c.banned = append(c.banned, id)
	return nil
}

func (c *fakeClerk) UnbanUser(_ context.Context, id string) error {
	if c.err != nil {
		return c.err
	}
	c.unbanned = append(c.unbanned, id)
	return nil
}

func (c *fakeClerk) RevokeSessions(_ context.Context, id string) error {
	if c.err != nil {
		return c.err
	}
	c.revoked = append(c.revoked, id)
	return nil
}

type fakeSubscriptions map[string]bool

func (f fakeSubscriptions) Renewing(_ context.Context, userID string) (bool, error) {
	return f[userID], nil
}

type fakeAdmins []string

func (a fakeAdmins) Contains(clerkUserID string) bool {
	for _, id := range a {
		if id == clerkUserID {
			return true
		}
	}
	return false
}

var errClerkDown = errors.New("clerk is down")

var testNow = time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
