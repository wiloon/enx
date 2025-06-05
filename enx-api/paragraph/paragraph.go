package paragraph

import (
	"enx-server/enx"
	"enx-server/middleware"
	"enx-server/utils/logger"

	"github.com/gin-gonic/gin"
)

// their 6-year-old to
func ParagraphInit(c *gin.Context) {
	paragraph := c.Query("paragraph")
	userId := middleware.GetUserIDFromContext(c)
	if userId == 0 {
		logger.Errorf("no valid user id found in session")
		c.JSON(401, gin.H{
			"success": false,
			"message": "Invalid session",
		})
		return
	}

	logger.Debugf("words count, paragraph: %s, user_id: %d", paragraph, userId)
	out := enx.QueryCountInText(paragraph, int(userId))
	c.JSON(200, gin.H{
		"data": out,
	})
}
