package enx

import (
	"enx-server/utils/logger"
	"regexp"
	"strings"
)

var nonAlphanumericRegex = regexp.MustCompile(`[^a-zA-Z\-' ]+`)

func QueryCountInText(words string) map[string]Word {
	// replace utf-8 \xe2\x80\x99 with '
	words = strings.ReplaceAll(words, "\xe2\x80\x99", "'")
	logger.Debug("query count, words: ", words)
	// replace non-alphanumeric with empty string
	words = nonAlphanumericRegex.ReplaceAllString(words, " ")
	logger.Debug("replace non alphanumeric, words: ", words)
	// replace multiple space with one space
	spaceRegex := regexp.MustCompile(`\s+`)
	words = spaceRegex.ReplaceAllString(words, " ")
	// trim start and end space
	words = strings.Trim(words, " ")
	wordsArray := strings.Split(words, " ")
	response := make(map[string]Word)
	for _, word := range wordsArray {
		wordObj := Word{}
		wordObj.SetEnglish(word)
		wordObj.FindId()
		if wordObj.Id ==0{
			wordObj.LoadCount = 0
			wordObj.AlreadyAcquainted = 0
		}else{
			ud := UserDict{}
			ud.WordId = wordObj.Id
			if ud.IsExist() {
				wordObj.LoadCount = ud.QueryCount
				wordObj.AlreadyAcquainted = ud.AlreadyAcquainted
			}else{
				wordObj.LoadByEnglish()
			}
		}
		response[wordObj.Raw] = wordObj
	}
	logger.Debug("words count: ", response)
	return response
}
