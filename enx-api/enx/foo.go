package enx

import (
	"enx-server/utils/logger"
	"regexp"
	"strings"
)

var nonAlphanumericRegex = regexp.MustCompile(`[^a-zA-Z\-' ]+`)

func QueryCountInText(words string) map[string]Word {
	// replace non-alphanumeric with empty string
	words = nonAlphanumericRegex.ReplaceAllString(words, " ")
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
		CheckAndMigrateQueryCount(wordObj.Id)
		wordObj.Translate()
		wordObj.FindQueryCount()
		response[wordObj.English] = wordObj
	}
	logger.Debug("words count: ", response)
	return response
}
