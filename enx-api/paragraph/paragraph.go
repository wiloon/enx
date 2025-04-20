package paragraph

import (
	"enx-server/enx"
	"enx-server/utils/logger"
	"github.com/gin-gonic/gin"
)

// their 6-year-old to
func ParagraphInit(c *gin.Context) {
	paragraph := c.Query("paragraph")
	logger.Debugf("words count, paragraph: %s", paragraph)
	out := enx.QueryCountInText(paragraph)
	c.JSON(200, gin.H{
		"data": out,
	})
}
