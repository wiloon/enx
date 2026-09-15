package reader

import (
	"errors"
	"net/http"
	"time"

	"enx-api/middleware"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type createDocumentRequest struct {
	Content string `json:"content"`
}

// CreateDocumentHandler handles POST /api/reader/documents.
func CreateDocumentHandler(c *gin.Context) {
	var req createDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
		return
	}

	userID := middleware.GetUserIDFromContext(c)
	doc, err := CreateDocument(c.Request.Context(), userID, req.Content, time.Now())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "id": doc.ID})
}

type documentSummaryResponse struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"createdAt"`
}

// ListDocumentsHandler handles GET /api/reader/documents.
func ListDocumentsHandler(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	docs, err := ListDocuments(c.Request.Context(), userID, time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to list documents"})
		return
	}

	summaries := make([]documentSummaryResponse, len(docs))
	for i, d := range docs {
		summaries[i] = documentSummaryResponse{ID: d.ID, CreatedAt: d.CreatedAt}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "documents": summaries})
}

// GetDocumentHandler handles GET /api/reader/documents/:id.
func GetDocumentHandler(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	doc, err := GetDocument(c.Request.Context(), userID, c.Param("id"), time.Now())
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "document not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to get document"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"id":        doc.ID,
		"content":   doc.Content,
		"createdAt": doc.CreatedAt,
		"expiresAt": doc.ExpiresAt,
	})
}

// DeleteDocumentHandler handles DELETE /api/reader/documents/:id.
func DeleteDocumentHandler(c *gin.Context) {
	userID := middleware.GetUserIDFromContext(c)
	if err := DeleteDocument(c.Request.Context(), userID, c.Param("id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to delete document"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
