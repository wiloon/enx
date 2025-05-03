package word

import (
	"enx-server/enx"
	"github.com/gin-gonic/gin"
	"strings"
	"strconv"
)

func LoadCount(c *gin.Context) {
	key := c.Query("words")
	userId := c.GetHeader("X-User-ID")
	if userId == "" {
		userId = "1" // 默认使用用户 ID 1
	}
	userIdInt, _ := strconv.Atoi(userId)
	
	words := strings.Split(key, "_")
	response := make(map[string]int)
	for _, word := range words {
		ecp := enx.Word{}
		ecp.SetEnglish(word)
		loadCount := ecp.FindQueryCount(userIdInt)
		response[ecp.English] = loadCount
	}

	c.JSON(200, gin.H{
		"data": response,
	})
}
