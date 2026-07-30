package translate

import (
	"enx-api/enx"
	"enx-api/middleware"
	"enx-api/utils/logger"

	"github.com/gin-gonic/gin"
)

func translateWord(c *gin.Context, raw string) {
	userId := middleware.GetUserIDFromContext(c)
	if userId == "" {
		logger.Errorf("no valid user id found in session")
		c.JSON(401, gin.H{
			"success": false,
			"message": "Invalid session",
		})
		return
	}

	logger.Debugf("translate word: %s, user_id: %s", raw, userId)

	if isSentence(raw) {
		respondSentenceUnavailable(c, raw)
		return
	}

	word := enx.Word{}
	word.SetEnglish(raw)
	word.Translate(userId)

	ok, filledFromEcdict := fillFromEcdict(c, &word, userId)
	if !ok {
		return
	}

	if word.Id != "" && !filledFromEcdict {
		logger.Infof("word exist in local dict: %v", raw)
		userDict := enx.UserDict{}
		userDict.UserId = userId
		userDict.WordId = word.Id
		if userDict.IsExist() {
			userDict.QueryCount = userDict.QueryCount + 1
			if userDict.AlreadyAcquainted == 1 {
				logger.Infof("word was marked as acquainted, resetting to unacquainted: %s", raw)
				userDict.AlreadyAcquainted = 0
			}
			userDict.UpdateQueryCount()
		} else {
			if word.LoadCount >= 0 {
				userDict.QueryCount = word.LoadCount + 1
			} else {
				userDict.QueryCount = 1
			}
			userDict.Save()
		}
	}

	word.FindQueryCount(userId)
	logger.Debugf("translate result: %+v", word)
	c.JSON(200, word)
}

// Translate handles GET /translate?word=
func Translate(c *gin.Context) {
	logger.Debugf("session id: %s", c.GetHeader("X-Session-ID"))
	translateWord(c, c.Query("word"))
}

// TranslateByWord handles GET /word/:word
func TranslateByWord(c *gin.Context) {
	logger.Debugf("session id: %s", c.GetHeader("X-Session-ID"))
	translateWord(c, c.Param("word"))
}
