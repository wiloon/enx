package enx

import (
	"enx-api/repo"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Word struct {
	// id in DB (UUID)
	Id string
	// raw paragraph item, e.g. `morning.`
	Raw string
	// english word, e.g. `morning`
	English       string
	Chinese       string
	Pronunciation string
	// key is lower case of english word, e.g. `morning`
	Key string

	// 0: false, 1: true
	AlreadyAcquainted int
	LoadCount         int
	// 0: default: normal type
	// 1: raw: this word would not be translated
	WordType int
}

// nonEnglish matches everything SetEnglish strips from a token. Compiled
// once: SetEnglish runs for every word of every page (paragraph-init).
var nonEnglish = regexp.MustCompile(`[^a-zA-Z\-'’ ]+`)

func (word *Word) SetEnglish(raw string) {
	raw = nonEnglish.ReplaceAllString(raw, "")

	english := ""
	if strings.Contains(raw, "'s") ||
		strings.Contains(raw, "’s") ||
		strings.Contains(raw, "'t") ||
		strings.Contains(raw, "'ve") ||
		strings.Contains(raw, "'m") ||
		strings.Contains(raw, "'d") ||
		strings.Contains(raw, "'re") {
		// do nothing
		english = raw
	} else {
		english = raw
		english = strings.TrimSuffix(english, "-")
		english = strings.TrimSuffix(english, "’")
		english = strings.TrimSuffix(english, ".")
		english = strings.TrimSuffix(english, ",")
		english = strings.TrimPrefix(english, "(")
		english = strings.TrimSuffix(english, ")")
		english = nonEnglish.ReplaceAllString(english, "")
	}

	// if english end with - or space, remove it
	if strings.HasSuffix(english, "-") || strings.HasSuffix(english, " ") {
		english = english[:len(english)-1]
	}
	word.Raw = raw
	word.SetEnglishField(english)
}

func (word *Word) FindId() {
	sWord := repo.GetWordByEnglish(word.English)
	word.Id = sWord.Id
}

func (word *Word) SetEnglishField(english string) {
	if strings.Contains(english, "'s") {
		tmpKey := strings.Replace(english, "'s", "", -1)
		word.English = tmpKey
		word.Key = strings.ToLower(tmpKey)
	} else if strings.Contains(english, "’s") {
		tmpKey := strings.Replace(english, "’s", "", -1)
		word.English = tmpKey
		word.Key = strings.ToLower(tmpKey)
	} else {
		word.English = english
		word.Key = strings.ToLower(english)
	}
}
func (word *Word) FindQueryCount(userId string) int {
	qc, acquainted, _ := repo.GetUserWordQueryCount(word.Id, userId)
	logger.Debugf("find query count, word id: %s, word: %s, user_id: %s, query count: %d",
		word.Id, word.English, userId, qc)
	word.LoadCount = qc
	word.AlreadyAcquainted = acquainted
	return qc
}

// Save inserts the word as a new row. On failure (e.g. the UNIQUE constraint
// on words.english) it returns the error and leaves word.Id untouched, so
// callers never hold an id that was not persisted.
func (word *Word) Save() error {
	sWord := repo.Word{}
	sWord.Id = uuid.NewString() // Generate UUID for new word
	// Set explicitly: GORM's auto timestamps on an int64 field are Unix
	// seconds, but words.created_at/updated_at are Unix milliseconds.
	now := time.Now().UnixMilli()
	sWord.CreatedAt = now
	sWord.UpdatedAt = now
	sWord.English = word.English
	sWord.Chinese = word.Chinese
	sWord.Pronunciation = word.Pronunciation
	sWord.LoadCount = word.LoadCount
	if err := sqlitex.DB.Create(&sWord).Error; err != nil {
		logger.Errorf("failed to save word: %s, error: %v", sWord.English, err)
		return err
	}
	logger.Debugf("save word: %v", sWord)
	word.Id = sWord.Id
	return nil
}
