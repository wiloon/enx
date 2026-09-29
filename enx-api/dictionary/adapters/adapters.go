// Package adapters implements the dictionary domain's ports on top of the
// application's storage: the words table and ECDICT. It sits outside
// package dictionary because repo/enx sit downstream of it in the import
// graph (dictionary -> stats -> middleware -> enx -> repo).
package adapters

import (
	"context"

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

func (Ecdict) Lookup(ctx context.Context, english string) (dictionary.Entry, bool) {
	d := ecdict.Query(ctx, english)
	if d == nil {
		return dictionary.Entry{}, false
	}
	return dictionary.Entry{
		English:       d.English,
		Chinese:       d.Chinese,
		Pronunciation: d.Pronunciation,
	}, true
}
