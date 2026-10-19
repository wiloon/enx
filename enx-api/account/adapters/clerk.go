// Package adapters binds the account domain to the Clerk Backend API and
// Stripe.
package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"enx-api/account"
)

// Clerk is account.Clerk over the Clerk Backend API (ADR-062 Decision 8),
// authenticated with CLERK_SECRET_KEY.
type Clerk struct {
	secretKey string
	// BaseURL and HTTP are the API's address and client; tests point them
	// at a fake.
	BaseURL string
	HTTP    *http.Client
}

var _ account.Clerk = (*Clerk)(nil)

func NewClerk(secretKey string) *Clerk {
	return &Clerk{
		secretKey: secretKey,
		BaseURL:   "https://api.clerk.com/v1",
		HTTP:      &http.Client{Timeout: 15 * time.Second},
	}
}

// DeleteUser deletes the Clerk user, which also ends their sessions. Clerk
// answers 404 for a user it no longer has: that counts as deleted, so a
// retried deletion gets past Clerk to the local data.
func (c *Clerk) DeleteUser(ctx context.Context, clerkUserID string) error {
	status, _, err := c.do(ctx, http.MethodDelete, "/users/"+url.PathEscape(clerkUserID), nil)
	if status == http.StatusNotFound {
		return nil
	}
	return err
}

func (c *Clerk) BanUser(ctx context.Context, clerkUserID string) error {
	_, _, err := c.do(ctx, http.MethodPost, "/users/"+url.PathEscape(clerkUserID)+"/ban", nil)
	return err
}

func (c *Clerk) UnbanUser(ctx context.Context, clerkUserID string) error {
	_, _, err := c.do(ctx, http.MethodPost, "/users/"+url.PathEscape(clerkUserID)+"/unban", nil)
	return err
}

// maxSessions is the most sessions one list call returns (Clerk's limit).
const maxSessions = 500

// RevokeSessions revokes each of the user's active sessions; Clerk has no
// single "sign out everywhere" call.
func (c *Clerk) RevokeSessions(ctx context.Context, clerkUserID string) error {
	q := url.Values{"user_id": {clerkUserID}, "status": {"active"}, "limit": {fmt.Sprint(maxSessions)}}
	_, body, err := c.do(ctx, http.MethodGet, "/sessions?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	sessions, err := decodeSessions(body)
	if err != nil {
		return err
	}
	for _, s := range sessions {
		if _, _, err := c.do(ctx, http.MethodPost, "/sessions/"+url.PathEscape(s.ID)+"/revoke", nil); err != nil {
			return err
		}
	}
	return nil
}

type session struct {
	ID string `json:"id"`
}

// decodeSessions reads the session list, a bare array or a paginated
// {"data": [...]} object.
func decodeSessions(body []byte) ([]session, error) {
	var list []session
	if err := json.Unmarshal(body, &list); err == nil {
		return list, nil
	}
	var page struct {
		Data []session `json:"data"`
	}
	if err := json.Unmarshal(body, &page); err != nil {
		return nil, fmt.Errorf("clerk: decode the session list: %w", err)
	}
	return page.Data, nil
}

// do sends one request and fails on any non-2xx answer; the status is
// returned either way.
func (c *Clerk) do(ctx context.Context, method, path string, body io.Reader) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("clerk: %s %s: %w", method, routeOf(path), err)
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return resp.StatusCode, nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return resp.StatusCode, data, fmt.Errorf("clerk: %s %s: status %d", method, routeOf(path), resp.StatusCode)
	}
	return resp.StatusCode, data, nil
}

// routeOf drops the query from path, for error messages.
func routeOf(path string) string {
	if u, err := url.Parse(path); err == nil {
		return u.Path
	}
	return path
}
