package enx

import (
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/spf13/viper"
)

// GetUserByClerkUserID looks up a user by their Clerk user id (`sub` claim).
func GetUserByClerkUserID(clerkUserID string) *User {
	user := User{}
	sqlitex.DB.Where("clerk_user_id = ?", clerkUserID).First(&user)
	return &user
}

// GetOrCreateByClerkUserID finds or auto-provisions a local user for a Clerk identity.
func GetOrCreateByClerkUserID(clerkUserID, email, name string) (string, error) {
	if clerkUserID == "" {
		return "", fmt.Errorf("empty clerk user id")
	}
	existing := GetUserByClerkUserID(clerkUserID)
	if existing.Id != "" {
		now := time.Now()
		if now.Sub(existing.LastLoginTime) >= viper.GetDuration("user.last-login-update-interval") {
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
	return u.Id, nil
}
