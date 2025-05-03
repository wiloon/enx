package paragraph

import (
	"enx-server/enx"
	"enx-server/utils/logger"
	"github.com/gin-gonic/gin"
	"strconv"
)

// their 6-year-old to
func ParagraphInit(c *gin.Context) {
	paragraph := c.Query("paragraph")
	userId := c.GetHeader("X-User-ID")
	if userId == "" {
		userId = "1" // 默认使用用户 ID 1
	}
	userIdInt, _ := strconv.Atoi(userId)
	
	logger.Debugf("words count, paragraph: %s, user_id: %d", paragraph, userIdInt)
	out := enx.QueryCountInText(paragraph, userIdInt)
	c.JSON(200, gin.H{
		"data": out,
	})
}
