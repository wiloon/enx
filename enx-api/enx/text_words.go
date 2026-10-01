package enx

import (
	"context"
	"regexp"
	"strings"

	"enx-api/repo"
)

// WordState is a cached word with one user's review state for it.
type WordState struct {
	ID                string
	English           string
	QueryCount        int
	AlreadyAcquainted int
}

// WordStateStore reads cached words together with a user's review state.
type WordStateStore interface {
	// FindByEnglish returns every live cached word matching one of
	// englishes case-insensitively, with userID's review state (zero when
	// the user has none).
	FindByEnglish(ctx context.Context, userID string, englishes []string) ([]WordState, error)
}

// RepoWordStates is the WordStateStore over the words and user_dicts tables.
type RepoWordStates struct{}

func (RepoWordStates) FindByEnglish(_ context.Context, userID string, englishes []string) ([]WordState, error) {
	rows, err := repo.WordStatesByEnglish(userID, englishes)
	if err != nil {
		return nil, err
	}
	states := make([]WordState, len(rows))
	for i, r := range rows {
		states[i] = WordState{ID: r.Id, English: r.English, QueryCount: r.QueryCount, AlreadyAcquainted: r.AlreadyAcquainted}
	}
	return states, nil
}

// TextWords tells, for every word of a page, whether it is cached and how
// far the reader has got with it (the paragraph-init lookup).
type TextWords struct {
	store WordStateStore
}

func NewTextWords(store WordStateStore) *TextWords {
	return &TextWords{store: store}
}

var whitespace = regexp.MustCompile(`\s+`)

// In returns the words of paragraph keyed by each token's cleaned raw form
// (Word.Raw), each with its words-row id and userID's review state. A token
// that starts with a digit ("6-year-old") comes back as WordType 1 and is
// not looked up. A word has one row whatever its case or apostrophe
// (ADR-043). All words are looked up in one query.
func (s *TextWords) In(ctx context.Context, paragraph, userID string) (map[string]Word, error) {
	words := make(map[string]Word)
	var lookup []string
	seen := make(map[string]bool)
	for _, token := range strings.Split(whitespace.ReplaceAllString(paragraph, " "), " ") {
		if token == "" {
			continue
		}
		if token[0] >= '0' && token[0] <= '9' {
			words[token] = Word{Raw: token, WordType: 1}
			continue
		}
		w := Word{}
		w.SetEnglish(token)
		words[w.Raw] = w
		if w.English != "" && !seen[w.English] {
			seen[w.English] = true
			lookup = append(lookup, w.English)
		}
	}
	if len(lookup) == 0 {
		return words, nil
	}

	states, err := s.store.FindByEnglish(ctx, userID, lookup)
	if err != nil {
		return nil, err
	}
	// words.english is unique case-insensitively, so each folded key has at
	// most one row.
	byKey := make(map[string]WordState, len(states))
	for _, st := range states {
		byKey[strings.ToLower(st.English)] = st
	}
	for raw, w := range words {
		if w.WordType == 1 || w.English == "" {
			continue
		}
		if st, ok := byKey[strings.ToLower(w.English)]; ok {
			w.Id = st.ID
			w.LoadCount = st.QueryCount
			w.AlreadyAcquainted = st.AlreadyAcquainted
			words[raw] = w
		}
	}
	return words, nil
}
