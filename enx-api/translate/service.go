package translate

import (
	"enx-server/enx"
	"enx-server/utils/logger"
	"enx-server/youdao"

	"strings"
	"github.com/gin-gonic/gin"
)

// search db by english, return chinese and pronunciation
func Translate(c *gin.Context) {
	raw := c.Query("word")
	logger.Debugf("translate word: %s", raw)

	// do not save sentence into DB
	if strings.Contains(raw, " ") {
		logger.Debugf("find from youdao: %s", raw)
		epc := youdao.Query(raw)
		word := enx.Word{}
		word.English = epc.English
		word.Key = strings.ToLower(epc.English)
		word.Chinese = epc.Chinese
		word.Pronunciation = epc.Pronunciation
		logger.Debugf("translate result: %+v", word)
		c.JSON(200, word)
		return
	}

	word := enx.Word{}
	word.SetEnglish(raw)
	word.Translate()

	if word.Id == 0 {
		logger.Debugf("find from youdao: %s", raw)
		epc := youdao.Query(word.English)
		word.English = epc.English
		word.Key = strings.ToLower(epc.English)
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
		logger.Infof("word exist in local dict: %v", raw)
		userDict := enx.UserDict{}
		userDict.UserId = 0
		userDict.WordId = word.Id
		if userDict.IsExist() {
			userDict.QueryCount = userDict.QueryCount + 1
			userDict.UpdateQueryCount()
		} else {
			if word.LoadCount>=0{
				userDict.QueryCount = word.LoadCount + 1
			}else{
				userDict.QueryCount = 1
			}
			userDict.Save()
		}
	}
	word.FindQueryCount()
	logger.Debugf("translate result: %+v", word)
	c.JSON(200, word)
}
