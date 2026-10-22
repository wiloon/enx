package enx

import (
	"context"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// NewUserHook runs once, right after a local user is provisioned -- e.g. to
// grant the sign-up trial (ADR-048 Decision 3), which is once per email
// (ADR-062). main wires it, so enx does not import billing.
type NewUserHook interface {
	NewUser(ctx context.Context, userID, email string) error
}

var newUserHook NewUserHook

// SetNewUserHook installs the hook; nil removes it.
func SetNewUserHook(h NewUserHook) { newUserHook = h }

// ErrNoEmail refuses to provision a user whose token carries no email: the
// session token's email claim is missing or broken (ADR-015, 2026-10-20
// note §3).
var ErrNoEmail = errors.New("enx: the session token carries no email")

// GetUserByClerkUserID looks up a user by their Clerk user id (`sub` claim).
func GetUserByClerkUserID(clerkUserID string) *User {
	user := User{}
	sqlitex.DB.Where("clerk_user_id = ?", clerkUserID).First(&user)
	return &user
}

// ClerkProfile is what a session token's custom claims say about the user:
// email, name and image_url (ADR-015, 2026-10-20 note).
type ClerkProfile struct {
	Email    string
	Name     string
	ImageURL string
}

// GetOrCreateByClerkUserID finds or auto-provisions a local user for a Clerk
// identity. An existing user's last_login_time is re-written only when it is
// older than lastLoginUpdateInterval (user.last-login-update-interval), since
// this runs on every authenticated request (docs/PERF_FIRST_QUERY_LATENCY.md).
func GetOrCreateByClerkUserID(clerkUserID string, p ClerkProfile, lastLoginUpdateInterval time.Duration) (string, error) {
	u, err := GetOrCreateClerkUser(clerkUserID, p, lastLoginUpdateInterval)
	if err != nil {
		return "", err
	}
	return u.Id, nil
}

// GetOrCreateClerkUser is GetOrCreateByClerkUserID returning the whole user,
// so the caller can check its status without a second query. It keeps an
// existing user's email, name and avatar in step with the token (ADR-015,
// 2026-10-20 note §2) and refuses to create a user without an email
// (ErrNoEmail). Users are told apart by Clerk user id only: an email another
// row already has is no conflict.
func GetOrCreateClerkUser(clerkUserID string, p ClerkProfile, lastLoginUpdateInterval time.Duration) (*User, error) {
	if clerkUserID == "" {
		return nil, fmt.Errorf("empty clerk user id")
	}
	p = ClerkProfile{
		Email:    strings.TrimSpace(p.Email),
		Name:     strings.TrimSpace(p.Name),
		ImageURL: strings.TrimSpace(p.ImageURL),
	}
	existing := GetUserByClerkUserID(clerkUserID)
	if existing.Id != "" {
		syncProfile(existing, p)
		now := time.Now()
		if now.Sub(existing.LastLoginTime) >= lastLoginUpdateInterval {
			_ = sqlitex.DB.Model(existing).Updates(map[string]interface{}{
				"last_login_time": now,
				"updated_at":      now,
			}).Error
		}
		return existing, nil
	}

	if p.Email == "" {
		return nil, ErrNoEmail
	}
	resolvedName := p.Name
	if resolvedName == "" {
		if at := strings.Index(p.Email, "@"); at > 0 {
			resolvedName = p.Email[:at]
		} else {
			resolvedName = p.Email
		}
	}

	u := &User{
		Id:            uuid.New().String(),
		ClerkUserID:   clerkUserID,
		Name:          resolvedName,
		Email:         p.Email,
		AvatarUrl:     p.ImageURL,
		Status:        "active",
		CreateTime:    time.Now(),
		UpdateTime:    time.Now(),
		LastLoginTime: time.Now(),
	}
	if err := u.Create(); err != nil {
		return nil, err
	}
	logger.Infof("provisioned clerk user clerk_user_id=%s id=%s name=%s", clerkUserID, u.Id, resolvedName)
	if newUserHook != nil {
		// The account exists either way; a failed hook is logged, never
		// turned into a failed sign-in.
		if err := newUserHook.NewUser(context.Background(), u.Id, p.Email); err != nil {
			logger.Errorf("new-user hook failed for user %s: %v", u.Id, err)
		}
	}
	return u, nil
}

// syncProfile writes each non-empty profile field that differs from u's and
// updates u to match. An empty claim never clears a stored value, and nothing
// is written when nothing differs. A failed write leaves u as stored: the
// next request compares again.
func syncProfile(u *User, p ClerkProfile) {
	email, name, avatar := u.Email, u.Name, u.AvatarUrl
	if p.Email != "" {
		email = p.Email
	}
	if p.Name != "" {
		name = p.Name
	}
	if p.ImageURL != "" {
		avatar = p.ImageURL
	}
	if email == u.Email && name == u.Name && avatar == u.AvatarUrl {
		return
	}
	now := time.Now()
	if err := sqlitex.WithoutLoggedValues(sqlitex.DB).Model(&User{}).Where("id = ?", u.Id).Updates(map[string]interface{}{
		"email":      email,
		"name":       name,
		"avatar_url": avatar,
		"updated_at": now,
	}).Error; err != nil {
		logger.Errorf("profile sync failed for user %s (recoverable: signed in with the stored profile, retried on the next request): %v", u.Id, err)
		return
	}
	u.Email, u.Name, u.AvatarUrl, u.UpdateTime = email, name, avatar, now
}
