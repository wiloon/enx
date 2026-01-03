package paragraph

import (
	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

// their 6-year-old to
func ParagraphInit(c *gin.Context) {
	paragraph := c.Query("paragraph")
	userId := middleware.GetUserIDFromContext(c)
	if userId == "" {
		logger.Errorf("no valid user id found in session")
		c.JSON(401, gin.H{
			"success": false,
			"message": "Invalid session",
		})
		return
	}

	logger.Debugf("words count, paragraph: %s, user_id: %s", paragraph, userId)
	out := enx.QueryCountInText(paragraph, userId)
	c.JSON(200, gin.H{
		"data": out,
	})
}
