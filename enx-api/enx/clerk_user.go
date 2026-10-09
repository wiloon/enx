package enx

import (
	"context"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// NewUserHook runs once, right after a local user is provisioned -- e.g. to
// grant the sign-up trial (ADR-048 Decision 3). main wires it, so enx does
// not import billing.
type NewUserHook interface {
	NewUser(ctx context.Context, userID string) error
}

var newUserHook NewUserHook

// SetNewUserHook installs the hook; nil removes it.
func SetNewUserHook(h NewUserHook) { newUserHook = h }

// GetUserByClerkUserID looks up a user by their Clerk user id (`sub` claim).
func GetUserByClerkUserID(clerkUserID string) *User {
	user := User{}
	sqlitex.DB.Where("clerk_user_id = ?", clerkUserID).First(&user)
	return &user
}

// GetOrCreateByClerkUserID finds or auto-provisions a local user for a Clerk
// identity. An existing user's last_login_time is re-written only when it is
// older than lastLoginUpdateInterval (user.last-login-update-interval), since
// this runs on every authenticated request (docs/PERF_FIRST_QUERY_LATENCY.md).
func GetOrCreateByClerkUserID(clerkUserID, email, name string, lastLoginUpdateInterval time.Duration) (string, error) {
	if clerkUserID == "" {
		return "", fmt.Errorf("empty clerk user id")
	}
	existing := GetUserByClerkUserID(clerkUserID)
	if existing.Id != "" {
		now := time.Now()
		if now.Sub(existing.LastLoginTime) >= lastLoginUpdateInterval {
			_ = sqlitex.DB.Model(existing).Updates(map[string]interface{}{
				"last_login_time": now,
				"updated_at":      now,
			}).Error
		}
		return existing.Id, nil
	}

	resolvedName := name
	if resolvedName == "" && email != "" {
		if at := strings.Index(email, "@"); at > 0 {
			resolvedName = email[:at]
		} else {
			resolvedName = email
		}
	}
	if resolvedName == "" {
		resolvedName = "user-" + clerkUserID[:min(8, len(clerkUserID))]
	}

	u := &User{
		Id:            uuid.New().String(),
		ClerkUserID:   clerkUserID,
		Name:          resolvedName,
		Email:         email,
		Status:        "active",
		CreateTime:    time.Now(),
		UpdateTime:    time.Now(),
		LastLoginTime: time.Now(),
	}
	if err := u.Create(); err != nil {
		return "", err
	}
	logger.Infof("provisioned clerk user clerk_user_id=%s id=%s name=%s", clerkUserID, u.Id, resolvedName)
	if newUserHook != nil {
		// The account exists either way; a failed hook is logged, never
		// turned into a failed sign-in.
		if err := newUserHook.NewUser(context.Background(), u.Id); err != nil {
			logger.Errorf("new-user hook failed for user %s: %v", u.Id, err)
		}
	}
	return u.Id, nil
}
