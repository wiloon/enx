package reader

import (
	"errors"
	"net/http"
	"time"

	"enx-api/middleware"
	"enx-api/reader/saving"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const readerConflictMessage = "This document was edited elsewhere. Reopen it from My Documents before editing again."

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
	UpdatedAt time.Time `json:"updatedAt"`
	Preview   string    `json:"preview"`
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
		summaries[i] = documentSummaryResponse{ //nolint:staticcheck // S1016: keep the response DTO decoupled from DocumentSummary
			ID:        d.ID,
			CreatedAt: d.CreatedAt,
			UpdatedAt: d.UpdatedAt,
			Preview:   d.Preview,
		}
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
		"version":   doc.Version,
		"createdAt": doc.CreatedAt,
		"expiresAt": doc.ExpiresAt,
	})
}

// UpdateDocumentHandler handles PUT /api/reader/documents/:id.
func UpdateDocumentHandler(c *gin.Context) {
	var req createDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
		return
	}

	legacyUpdateDocument(c, req.Content)
}

func legacyUpdateDocument(c *gin.Context, content string) {
	userID := middleware.GetUserIDFromContext(c)
	doc, err := UpdateDocument(c.Request.Context(), userID, c.Param("id"), content, time.Now())
	if errors.Is(err, saving.ErrVersionConflict) {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": readerConflictMessage})
		return
	}

	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "document not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"id":        doc.ID,
		"content":   doc.Content,
		"version":   doc.Version,
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

// NewSaveDocumentHandler accepts versioned saves and retains the legacy PUT
// for old clients that have not yet loaded the versioned Reader.
func NewSaveDocumentHandler(service *saving.SaveService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Content string `json:"content"`
			Version *int64 `json:"version"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
			return
		}
		if req.Version == nil {
			// An old client may only edit documents that are still unversioned.
			legacyUpdateDocument(c, req.Content)
			return
		}
		doc, err := service.Save(c.Request.Context(), middleware.GetUserIDFromContext(c), c.Param("id"), req.Content, *req.Version, time.Now())
		if err != nil {
			status := http.StatusInternalServerError
			message := "Failed to save document"
			switch {
			case errors.Is(err, saving.ErrDocumentUnavailable):
				status = http.StatusNotFound
				message = err.Error()
			case errors.Is(err, saving.ErrVersionConflict):
				status = http.StatusConflict
				message = readerConflictMessage
			case errors.Is(err, saving.ErrInvalidSave), errors.Is(err, ErrContentEmpty), errors.Is(err, ErrContentTooLong):
				status = http.StatusBadRequest
				message = err.Error()
			}
			c.JSON(status, gin.H{"success": false, "message": message})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "id": doc.ID, "version": doc.Version})
	}
}
