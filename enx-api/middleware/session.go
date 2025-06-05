package middleware

import (
	"enx-server/utils/logger"
	"enx-server/utils/sqlitex"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type Session struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	UserID    int64     `json:"user_id"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

// GetUserIDFromContext gets user id from gin context
func GetUserIDFromContext(c *gin.Context) int64 {
	userID, exists := c.Get("user_id")
	if !exists {
		return 0
	}
	return userID.(int64)
}

// SessionMiddleware handles session authentication
func SessionMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		sessionID := c.GetHeader("X-Session-ID")
		if sessionID == "" {
			// Try to get from cookie
			cookie, err := c.Cookie("session_id")
			if err == nil {
				sessionID = cookie
			}
		}

		if sessionID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "No session found",
			})
			c.Abort()
			return
		}

		var session Session
		result := sqlitex.DB.Where("id = ? AND expires_at > ?", sessionID, time.Now()).First(&session)
		if result.Error != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "Invalid or expired session",
			})
			c.Abort()
			return
		}

		// Store session info in context
		c.Set("user_id", session.UserID)
		c.Set("session_id", sessionID)

		// Update session expiration time
		session.ExpiresAt = time.Now().Add(24 * time.Hour)
		sqlitex.DB.Save(&session)

		c.Next()
	}
}

// CreateSession creates a new session
func CreateSession(userID int64) (*Session, error) {
	session := &Session{
		ID:        generateSessionID(),
		UserID:    userID,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}
	logger.Infof("creating session, user id: %v, session: %+v", userID, session)
	if err := sqlitex.DB.Create(session).Error; err != nil {
		logger.Errorf("failed to create session: %v", err)
		return nil, err
	}

	return session, nil
}

// DeleteSession deletes a session
func DeleteSession(sessionID string) error {
	return sqlitex.DB.Where("id = ?", sessionID).Delete(&Session{}).Error
}

// generateSessionID generates a unique session ID
func generateSessionID() string {
	// Use UUID to generate session ID
	return uuid.New().String()
}
