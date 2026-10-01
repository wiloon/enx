// Package adapters implements the dictionary domain's ports on top of the
// application's storage: the words table and ECDICT. It sits outside
// package dictionary because repo/enx sit downstream of it in the import
// graph (dictionary -> stats -> middleware -> enx -> repo).
package adapters

import (
	"context"
	"errors"

	"enx-api/dictionary"
	"enx-api/ecdict"
	"enx-api/enx"
	"enx-api/repo"
)

// WordsTable is the dictionary.WordStore backed by the words table.
type WordsTable struct{}

func (WordsTable) Find(_ context.Context, english string) (string, dictionary.Entry, bool, error) {
	w := repo.GetWordByEnglish(english)
	if w.Id == "" {
		return "", dictionary.Entry{}, false, nil
	}
	return w.Id, dictionary.Entry{
		English:       w.English,
		Chinese:       w.Chinese,
		Pronunciation: w.Pronunciation,
	}, true, nil
}

func (WordsTable) Add(_ context.Context, entry dictionary.Entry) (string, error) {
	w := enx.Word{
		English:       entry.English,
		Chinese:       entry.Chinese,
		Pronunciation: entry.Pronunciation,
	}
	if err := w.Save(); err != nil {
		// words.english is UNIQUE: the headword is already cached.
		w.FindId()
		if w.Id == "" {
			return "", err
		}
	}
	return w.Id, nil
}

// Ecdict is the dictionary.ExternalDictionary backed by ECDICT.
type Ecdict struct{}

func (Ecdict) Available() bool { return ecdict.IsAvailable() }

func (Ecdict) Lookup(ctx context.Context, english string) (dictionary.Entry, error) {
	row, _, err := ecdict.Find(ctx, english)
	switch {
	case errors.Is(err, ecdict.ErrNotFound):
		return dictionary.Entry{}, dictionary.ErrNotInDictionary
	case errors.Is(err, ecdict.ErrTimeout):
		return dictionary.Entry{}, dictionary.ErrExternalTimeout
	case err != nil:
		return dictionary.Entry{}, err
	}
	return dictionary.Entry{
		English:       row.Word,
		Chinese:       row.Translation,
		Pronunciation: row.Phonetic,
	}, nil
}
