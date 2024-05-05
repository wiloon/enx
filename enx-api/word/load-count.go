package word

import (
	"enx-server/enx"
	"github.com/gin-gonic/gin"
	"strings"
)

func LoadCount(c *gin.Context) {
	key := c.Query("words")
	words := strings.Split(key, "_")
	response := make(map[string]int)
	for _, word := range words {
		ecp := enx.Word{}
		ecp.SetEnglish(word)
		loadCount := ecp.FindQueryCount()
		response[ecp.English] = loadCount
	}

	c.JSON(200, gin.H{
		"data": response,
	})
}
