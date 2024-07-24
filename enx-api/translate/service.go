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
		word.Save()

		userDict := enx.UserDict{}
		userDict.UserId = 0
		userDict.WordId = word.Id
		userDict.AlreadyAcquainted = word.AlreadyAcquainted
		userDict.QueryCount = 1
		userDict.Save()
	} else {
		logger.Infof("word exist in local dict: %v", english)
		userDict := enx.UserDict{}
		userDict.UserId = 0
		userDict.WordId = word.Id
		userDict.AlreadyAcquainted = word.AlreadyAcquainted
		userDict.QueryCount = word.LoadCount + 1
		if userDict.IsExist() {
			userDict.UpdateQueryCount()
		} else {
			userDict.Save()
		}
	}
	word.FindQueryCount()
	c.JSON(200, word)
}
