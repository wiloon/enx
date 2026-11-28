package adapters

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"enx-api/dictionary"
	"enx-api/utils/sqlitex"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AIEnglishDefinitions is the dictionary.EnglishAIStore backed by the
// ai_english_definitions table (ADR-098 Decision 5).
type AIEnglishDefinitions struct{}

type senseWire struct {
	Pos     string `json:"pos"`
	Gloss   string `json:"gloss"`
	Example string `json:"example,omitempty"`
}

func (AIEnglishDefinitions) Find(ctx context.Context, wordID string) (dictionary.EnglishAIRow, bool, error) {
	var row sqlitex.AIEnglishDefinition
	err := sqlitex.DB.WithContext(ctx).Where("word_id = ?", wordID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return dictionary.EnglishAIRow{}, false, nil
	}
	if err != nil {
		return dictionary.EnglishAIRow{}, false, err
	}
	senses, err := decodeSenses(row.Senses)
	if err != nil {
		return dictionary.EnglishAIRow{}, false, err
	}
	return dictionary.EnglishAIRow{
		WordID:        row.WordID,
		Senses:        senses,
		Quality:       row.Quality,
		PromptVersion: row.PromptVersion,
	}, true, nil
}

// Insert keeps the first row on conflict (concurrent misses of one word).
func (AIEnglishDefinitions) Insert(ctx context.Context, row dictionary.EnglishAIRow) (bool, error) {
	raw, err := encodeSenses(row.Senses)
	if err != nil {
		return false, err
	}
	now := time.Now().UnixMilli()
	result := sqlitex.DB.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&sqlitex.AIEnglishDefinition{
		WordID:        row.WordID,
		Senses:        raw,
		Quality:       row.Quality,
		PromptVersion: row.PromptVersion,
		CreatedAt:     now,
		UpdatedAt:     now,
	})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

func encodeSenses(senses []dictionary.Sense) (string, error) {
	wire := make([]senseWire, len(senses))
	for i, s := range senses {
		wire[i] = senseWire{Pos: s.POS, Gloss: s.Gloss, Example: s.Example}
	}
	b, err := json.Marshal(wire)
	return string(b), err
}

func decodeSenses(raw string) ([]dictionary.Sense, error) {
	var wire []senseWire
	if err := json.Unmarshal([]byte(raw), &wire); err != nil {
		return nil, err
	}
	senses := make([]dictionary.Sense, len(wire))
	for i, s := range wire {
		senses[i] = dictionary.Sense{POS: s.Pos, Gloss: s.Gloss, Example: s.Example}
	}
	return senses, nil
}
