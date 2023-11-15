package enx

import (
	"enx-server/utils/logger"
	"regexp"
	"strings"
)

var nonAlphanumericRegex = regexp.MustCompile(`[^a-zA-Z\-' ]+`)

func WordsCount0(words string) map[string]Word {
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
		ecp := Word{}
		ecp.SetEnglish(word)
		ecp.FindLoadCount()
		ecp.SetEnglish(word) // since raw english will replace by dict english, re set English here temporally
		response[ecp.English] = ecp
	}
	logger.Debug("words count: ", response)
	return response
}
