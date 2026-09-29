package paragraph

import (
	"context"
	"net/http"

	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// TextWords looks up every word of a paragraph for a user: enx.TextWords in
// production.
type TextWords interface {
	In(ctx context.Context, paragraph, userID string) (map[string]enx.Word, error)
}

// Handler serves /api/paragraph-init.
type Handler struct {
	words TextWords
}

func NewHandler(words TextWords) *Handler {
	return &Handler{words: words}
}

// paragraphRequest is the body of QUERY and POST /api/paragraph-init.
type paragraphRequest struct {
	Paragraph string `json:"paragraph"`
}

// ParagraphInitBody handles QUERY /api/paragraph-init (the default) and POST
// /api/paragraph-init (the fallback for networks that reject QUERY), with
// the paragraph in a JSON body: the id and the caller's review state of
// every word, so the extension can underline them.
//
// This is a read-only, idempotent query (ADR-041). Its input is page text,
// which is why it travels in the body rather than the URL, where CDN and
// proxy access logs would record it. QUERY (RFC 10008) says exactly that;
// POST carries the same request where QUERY cannot get through.
func (h *Handler) ParagraphInitBody(c *gin.Context) {
	// RFC 10008: fail a request whose Content-Type is missing or does not
	// match its content.
	if c.ContentType() != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{
			"success": false,
			"message": "Content-Type must be application/json",
		})
		return
	}
	var req paragraphRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Invalid request body",
		})
		return
	}
	c.Header("Accept-Query", "application/json")
	h.respond(c, req.Paragraph)
}

// ParagraphInit handles GET /api/paragraph-init?paragraph=.
//
// Deprecated: the paragraph is page text, and in a query string it lands in
// CDN and proxy access logs (ADR-041). Kept only for extension builds that
// predate QUERY/POST; remove once they are gone.
func (h *Handler) ParagraphInit(c *gin.Context) {
	h.respond(c, c.Query("paragraph"))
}

func (h *Handler) respond(c *gin.Context, paragraph string) {
	userId := middleware.GetUserIDFromContext(c)
	if userId == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "Invalid session",
		})
		return
	}

	out, err := h.words.In(c.Request.Context(), paragraph, userId)
	if err != nil {
		logger.Errorf("paragraph-init for %s: %v", userId, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "Failed to load word states",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"data": out,
	})
}
