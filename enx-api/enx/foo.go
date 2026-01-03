package enx

import (
	"enx-api/utils/logger"
	"regexp"
	"strings"
)

func QueryCountInText(paragraph string, userId string) map[string]Word {
	words := paragraph
	logger.Infof("query count, paragraph: %s, user_id: %s", words, userId)

	// replace multiple space with one space
	spaceRegex := regexp.MustCompile(`\s+`)
	words = spaceRegex.ReplaceAllString(words, " ")

	wordsArray := strings.Split(words, " ")
	response := make(map[string]Word)
	for _, word_raw := range wordsArray {
		// check if word_raw is start with a digit
		// 6-year-old
		logger.Infof("word_raw: %s", word_raw)
		if len(word_raw) == 0 {
			continue
		}

		if word_raw[0] >= '0' && word_raw[0] <= '9' {
			wordObj := Word{}
			wordObj.Raw = word_raw
			wordObj.WordType = 1
			response[wordObj.Raw] = wordObj
			continue
		}

		wordObj := Word{}
		wordObj.SetEnglish(word_raw)
		wordObj.FindId()
		if wordObj.Id == "" {
			wordObj.LoadCount = 0
			wordObj.AlreadyAcquainted = 0
		} else {
			ud := UserDict{}
			ud.WordId = wordObj.Id
			ud.UserId = userId // Set user ID
			if ud.IsExist() {
				wordObj.LoadCount = ud.QueryCount
				wordObj.AlreadyAcquainted = ud.AlreadyAcquainted
			} else {
				wordObj.LoadCount = 0
				wordObj.AlreadyAcquainted = 0
			}
		}
		// add log, print word id, english, chinese, load count
		logger.Infof("word: %s, id: %d, chinese: %s, load count: %d, already acquainted: %d",
			wordObj.English, wordObj.Id, wordObj.Chinese, wordObj.LoadCount, wordObj.AlreadyAcquainted)

		response[wordObj.Raw] = wordObj
	}
	logger.Debug("words count: ", response)
	return response
}
