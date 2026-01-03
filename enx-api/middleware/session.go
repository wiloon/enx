package middleware

import (
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type Session struct {
	ID        string `json:"id" gorm:"primaryKey"`
	UserID    string `json:"user_id" gorm:"column:user_id"`
	CreatedAt int64  `json:"created_at" gorm:"column:created_at"` // Unix milliseconds
	ExpiresAt int64  `json:"expires_at" gorm:"column:expires_at"` // Unix milliseconds
}

// GetUserIDFromContext gets user id from gin context
func GetUserIDFromContext(c *gin.Context) string {
	userID, exists := c.Get("user_id")
	if !exists {
		return ""
	}
	return userID.(string)
}

// SessionMiddleware handles session authentication
func SessionMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		logger.Infof("SessionMiddleware: Processing request %s %s", c.Request.Method, c.Request.URL.Path)

		// Skip authentication for OPTIONS requests (CORS preflight)
		if c.Request.Method == "OPTIONS" {
			logger.Infof("SessionMiddleware: Skipping auth for OPTIONS request")
			c.Next()
			return
		}

		sessionID := c.GetHeader("X-Session-ID")
		logger.Infof("SessionMiddleware: X-Session-ID header: '%s'", sessionID)

		if sessionID == "" {
			// Try to get from cookie
			cookie, err := c.Cookie("session_id")
			if err == nil {
				sessionID = cookie
				logger.Infof("SessionMiddleware: Session ID from cookie: '%s'", sessionID)
			} else {
				logger.Infof("SessionMiddleware: No session_id cookie found, error: %v", err)
			}
		}

		if sessionID == "" {
			logger.Errorf("SessionMiddleware: No session ID found in header or cookie")
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "No session found",
			})
			c.Abort()
			return
		}

		logger.Infof("SessionMiddleware: Looking up session ID: '%s'", sessionID)
		var session Session
		now := time.Now().UnixMilli()
		result := sqlitex.DB.Where("id = ? AND expires_at > ?", sessionID, now).First(&session)
		if result.Error != nil {
			logger.Errorf("SessionMiddleware: Session lookup failed for ID '%s', error: %v", sessionID, result.Error)
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "Invalid or expired session",
			})
			c.Abort()
			return
		}

		logger.Infof("SessionMiddleware: Session found for user ID: %s", session.UserID)

		// Store session info in context
		c.Set("user_id", session.UserID)
		c.Set("session_id", sessionID)

		// Update session expiration time
		session.ExpiresAt = time.Now().Add(24 * time.Hour).UnixMilli()

		c.Next()
	}
}

// CreateSession creates a new session
func CreateSession(userID string) (*Session, error) {
	now := time.Now()
	session := &Session{
		ID:        generateSessionID(),
		UserID:    userID,
		CreatedAt: now.UnixMilli(),
		ExpiresAt: now.Add(24 * time.Hour).UnixMilli(),
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
