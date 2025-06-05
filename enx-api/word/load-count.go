package word

import (
	"enx-server/enx"
	"enx-server/middleware"
	"strings"

	"github.com/gin-gonic/gin"
)

func LoadCount(c *gin.Context) {
	key := c.Query("words")
	userId := middleware.GetUserIDFromContext(c)
	if userId == 0 {
		c.JSON(401, gin.H{
			"success": false,
			"message": "Invalid session",
		})
		return
	}

	words := strings.Split(key, "_")
	response := make(map[string]int)
	for _, word := range words {
		ecp := enx.Word{}
		ecp.SetEnglish(word)
		loadCount := ecp.FindQueryCount(int(userId))
		response[ecp.English] = loadCount
	}

	c.JSON(200, gin.H{
		"data": response,
	})
}
