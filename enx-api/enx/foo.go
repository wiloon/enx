package enx

import (
	"fmt"
	"regexp"
	"strings"
)

var nonAlphanumericRegex = regexp.MustCompile(`[^a-zA-Z\- ]+`)

func WordsCount0(words string) map[string]Word {
	// replace non-alphanumeric with empty string
	words = nonAlphanumericRegex.ReplaceAllString(words, "")
	fmt.Println(words)
	// replace multiple space with one space
	spaceRegex := regexp.MustCompile(`\s+`)
	words = spaceRegex.ReplaceAllString(words, " ")
	fmt.Println(words)
	// trim start and end space
	words = strings.Trim(words, " ")
	wordsArray := strings.Split(words, " ")
	fmt.Println(len(wordsArray))
	fmt.Println(wordsArray)
	response := make(map[string]Word)
	for _, word := range wordsArray {
		ecp := Word{}
		ecp.SetEnglish(word)
		ecp.FindLoadCount()
		response[ecp.English] = ecp
	}
	return response
}
