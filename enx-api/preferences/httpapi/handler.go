// Package httpapi serves users' preferences over HTTP (ADR-044).
package httpapi

import (
	"context"
	"errors"
	"net/http"

	"enx-api/middleware"
	"enx-api/platform/httpjson"
	"enx-api/preferences"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// Service is the slice of preferences.Service the handler uses.
type Service interface {
	Get(ctx context.Context, userID string) (map[preferences.Key]preferences.View, error)
	Update(ctx context.Context, userID string, changes map[string]any) error
}

// Handler serves GET and PUT /api/me/preferences.
type Handler struct {
	svc Service
}

func NewHandler(svc Service) *Handler {
	return &Handler{svc: svc}
}

// preferenceJSON is one preference on the wire: the user's explicit choice
// (null when unset), the value the server acts on, and whether the user may
// change it. A value is a boolean or a string, as the key's type is.
type preferenceJSON struct {
	Value     any  `json:"value"`
	Effective any  `json:"effective"`
	Editable  bool `json:"editable"`
}

func preferencesBody(views map[preferences.Key]preferences.View) map[string]preferenceJSON {
	body := make(map[string]preferenceJSON, len(views))
	for key, v := range views {
		body[string(key)] = preferenceJSON{Value: v.Value, Effective: v.Effective, Editable: v.Editable}
	}
	return body
}

// Get returns every preference for the signed-in user.
func (h *Handler) Get(c *gin.Context) {
	userID, ok := middleware.RequireUserID(c, "Unauthorized")
	if !ok {
		return
	}
	views, err := h.svc.Get(c.Request.Context(), userID)
	if err != nil {
		logger.Errorf("❌ preferences: read failed for user %s: %v", userID, err)
		httpjson.Fail(c, http.StatusInternalServerError, "Preferences are temporarily unavailable.")
		return
	}
	c.JSON(http.StatusOK, preferencesBody(views))
}

// Update applies a partial change -- {"key": value|null}, where null returns
// the key to its default -- and answers with the full set, as Get does. What
// each key may hold is the service's rule, not the handler's.
func (h *Handler) Update(c *gin.Context) {
	userID, ok := middleware.RequireUserID(c, "Unauthorized")
	if !ok {
		return
	}
	var changes map[string]any
	if err := c.ShouldBindJSON(&changes); err != nil || len(changes) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "invalid_body", "message": "Send a JSON object of preferences to change."})
		return
	}

	switch err := h.svc.Update(c.Request.Context(), userID, changes); {
	case err == nil:
	case errors.Is(err, preferences.ErrUnknownKey):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "unknown_preference", "message": "Unknown preference."})
		return
	case errors.Is(err, preferences.ErrInvalidValue):
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": "invalid_value", "message": "That value isn't allowed for this preference. Send null to restore the default."})
		return
	case errors.Is(err, preferences.ErrNotEditable):
		c.JSON(http.StatusForbidden, gin.H{"success": false, "code": "not_entitled", "message": "This setting is available with a subscription or a credit balance."})
		return
	default:
		logger.Errorf("❌ preferences: update failed for user %s: %v", userID, err)
		httpjson.Fail(c, http.StatusInternalServerError, "Preferences are temporarily unavailable.")
		return
	}

	h.Get(c)
}
