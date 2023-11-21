package translate

import (
	"enx-server/enx"
	"enx-server/utils/logger"
	"enx-server/youdao"
	"github.com/gin-gonic/gin"
	"regexp"
)

func Translate(c *gin.Context) {
	english := c.Query("word")
	logger.Debugf("translate word: %s", english)
	english = regexp.MustCompile(`[^a-zA-Z\- ]+`).ReplaceAllString(english, "")
	word := enx.Word{}
	word.SetEnglish(english)

	word.Translate()
	if word.Chinese == "" {
		logger.Debugf("find from youdao: %s", english)
		epc := youdao.Query(english)
		word.Chinese = epc.Chinese
		word.Pronunciation = epc.Pronunciation
		word.LoadCount = 1
		word.Save()
	} else {
		word.LoadCount = word.LoadCount + 1
		word.UpdateLoadCount()
	}
	word.FindQueryCount()
	c.JSON(200, word)
}
