package enx

import (
	"enx-api/dictionary/wordform"
	"enx-api/repo"
	"enx-api/utils/logger"
	"enx-api/utils/sqlitex"
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
	Known     bool
	LoadCount int
	// 0: default: normal type
	// 1: raw: this word would not be translated
	WordType int

	// Where the definition first came from, "ecdict" or "ai" (ADR-045). Left
	// out when empty so the many places that serialize a Word without a
	// lookup behind it don't grow a field.
	Origin string `json:"Origin,omitempty"`

	// Which source answered this lookup: "local" (the words table),
	// "ecdict", "miss", "timeout" or "error" (ADR-040). Set only on a lookup
	// answer; not the same thing as Origin.
	Source string `json:"Source,omitempty"`

	// What the AI fallback offers after a lookup found nothing (ADR-045).
	// Present only on such a miss, and only when the fallback is set up.
	AIFallback *AIFallback `json:"AIFallback,omitempty"`
}

// AIFallback is what the AI word fallback offers the user who just missed a
// word. CanUse: they may use it at all (the client offers a manual "look it up
// with AI" button). Auto: it should also start by itself. Both are decided on
// the server; the client only acts on them.
type AIFallback struct {
	CanUse bool
	Auto   bool
}

func (word *Word) SetEnglish(raw string) {
	word.Raw = wordform.Clean(raw)
	english := wordform.Normalize(raw)
	word.English = english
	word.Key = strings.ToLower(english)
}

func (word *Word) FindId() {
	sWord := repo.GetWordByEnglish(word.English)
	word.Id = sWord.Id
}

func (word *Word) SetEnglishField(english string) {
	english = wordform.Canonical(english)
	word.English = english
	word.Key = strings.ToLower(english)
}
func (word *Word) FindQueryCount(userId string) int {
	qc, known, _ := repo.GetUserWordQueryCount(word.Id, userId)
	logger.Debugf("find query count, word id: %s, word: %s, user_id: %s, query count: %d",
		word.Id, word.English, userId, qc)
	word.LoadCount = qc
	word.Known = known
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
	sWord.English = repo.CanonicalEnglish(word.English)
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
