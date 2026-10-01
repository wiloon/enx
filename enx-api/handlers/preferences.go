package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"enx-api/middleware"
	"enx-api/preferences"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// PreferenceService is the slice of preferences.Service the handlers use.
type PreferenceService interface {
	Get(ctx context.Context, userID string) (map[preferences.Key]preferences.View, error)
	Update(ctx context.Context, userID string, changes map[string]*bool) error
}

// PreferencesHandler serves GET and PUT /api/me/preferences (ADR-044).
type PreferencesHandler struct {
	svc PreferenceService
}

func NewPreferencesHandler(svc PreferenceService) *PreferencesHandler {
	return &PreferencesHandler{svc: svc}
}

// preferenceJSON is one preference on the wire: the user's explicit choice
// (null when unset), the value the server acts on, and whether the user may
// change it.
type preferenceJSON struct {
	Value     *bool `json:"value"`
	Effective bool  `json:"effective"`
	Editable  bool  `json:"editable"`
}

func preferencesBody(views map[preferences.Key]preferences.View) map[string]preferenceJSON {
	body := make(map[string]preferenceJSON, len(views))
	for key, v := range views {
		body[string(key)] = preferenceJSON{Value: v.Value, Effective: v.Effective, Editable: v.Editable}
	}
	return body
}

// Get returns every preference for the signed-in user.
func (h *PreferencesHandler) Get(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Unauthorized"})
		return
	}
	views, err := h.svc.Get(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("❌ preferences: read failed for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Preferences are temporarily unavailable."})
		return
	}
	c.JSON(http.StatusOK, preferencesBody(views))
}

// Update applies a partial change -- {"key": true|false|null}, where null
// returns the key to its default -- and answers with the full set, as Get
// does.
func (h *PreferencesHandler) Update(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Unauthorized"})
		return
	}
	var raw map[string]json.RawMessage
	if err := c.ShouldBindJSON(&raw); err != nil || len(raw) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "invalid_body", "message": "Send a JSON object of preferences to change."})
		return
	}
	changes := make(map[string]*bool, len(raw))
	for key, value := range raw {
		var v *bool
		if err := json.Unmarshal(value, &v); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "invalid_value", "message": "Each preference must be true, false or null."})
			return
		}
		changes[key] = v
	}

	switch err := h.svc.Update(c.Request.Context(), userID, changes); {
	case err == nil:
	case errors.Is(err, preferences.ErrUnknownKey):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "unknown_preference", "message": "Unknown preference."})
		return
	case errors.Is(err, preferences.ErrNotEditable):
		c.JSON(http.StatusForbidden, gin.H{"success": false, "code": "not_entitled", "message": "This setting is available with a subscription or a credit balance."})
		return
	default:
		logger.Errorf("❌ preferences: update failed for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Preferences are temporarily unavailable."})
		return
	}

	h.Get(c)
}
