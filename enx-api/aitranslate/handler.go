package aitranslate

import (
	"net/http"

	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

type sentenceRequest struct {
	Sentence string `json:"sentence" binding:"required"`
}

// Handler wraps a Translator (which may be nil if sentence translation is
// not configured, see New) so it can be registered as a gin route handler.
type Handler struct {
	translator Translator
}

func NewHandler(translator Translator) *Handler {
	return &Handler{translator: translator}
}

// TranslateSentence handles POST /translate/sentence and POST
// /api/translate/sentence. It never returns a 200 with an empty/partial
// translation: unavailable or failed translation is always an explicit
// 502, matching the "no silent empty result" convention from
// ADR-0001 (see translate/helpers.go RespondUnavailable-style handling).
func (h *Handler) TranslateSentence(c *gin.Context) {
	var req sentenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "sentence is required"})
		return
	}

	if h.translator == nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "sentence translation is not configured"})
		return
	}

	chinese, err := h.translator.TranslateSentence(c.Request.Context(), req.Sentence)
	if err != nil {
		logger.Errorf("aitranslate: TranslateSentence failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "translation service unavailable"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "chinese": chinese})
}
