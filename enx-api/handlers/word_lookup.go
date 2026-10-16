package handlers

import (
	"net/http"

	"enx-api/middleware"
	"enx-api/repo"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

type wordLookupRequest struct {
	WordID string `json:"wordId"`
}

// RecordWordLookup handles POST /api/me/word-lookups: the caller looked up
// the word with this id, so its query count goes up by one and it leaves
// "known" (ADR-059 Decision 3). The extension sends it once per
// click-to-lookup, after the lookup GET answered with a word id.
//
// It is the only writer of the query count. It is not idempotent and not
// retried; a lost one leaves the count one short. It is not a lookup
// request either: no quota, no lookup event.
func RecordWordLookup(c *gin.Context) {
	userId := middleware.GetUserIDFromContext(c)
	if userId == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "Invalid session",
		})
		return
	}

	var req wordLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.WordID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "A word id is required."})
		return
	}

	exists, err := repo.WordExists(req.WordID)
	if err != nil {
		logger.Errorf("RecordWordLookup: find word %s: %v", req.WordID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to record the lookup"})
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "Word not found"})
		return
	}

	qc, acquainted, err := repo.RecordWordLookup(userId, req.WordID)
	if err != nil {
		logger.Errorf("RecordWordLookup: record %s for %s: %v", req.WordID, userId, err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to record the lookup"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"queryCount": qc, "alreadyAcquainted": acquainted})
}
