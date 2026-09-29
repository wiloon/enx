package translate

import (
	"enx-api/enx"
	"strings"

	"github.com/gin-gonic/gin"
)

func isSentence(raw string) bool {
	return strings.Contains(raw, " ")
}

func respondSentenceUnavailable(c *gin.Context, raw string) {
	word := enx.Word{}
	word.English = raw
	word.Key = strings.ToLower(raw)
	word.Chinese = SentenceTranslationNotice
	c.JSON(200, word)
}
