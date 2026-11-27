package main

// The rules that turn one Wiktextract object into the rows of the Wiktionary
// file. No I/O here. Bump builderVersion on every change to these rules or to
// the ones database.go applies after the load.

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"enx-api/dictionary/wordform"
)

const builderVersion = "1"

// wiktextractEntry holds the fields of an input line the builder reads.
type wiktextractEntry struct {
	Word            string  `json:"word"`
	LangCode        string  `json:"lang_code"`
	Pos             string  `json:"pos"`
	EtymologyNumber *number `json:"etymology_number"`
	Senses          []struct {
		Glosses  []string `json:"glosses"` // general -> most specific
		Tags     []string `json:"tags"`
		Examples []struct {
			Text string `json:"text"`
			Type string `json:"type"`
			Ref  string `json:"ref"`
		} `json:"examples"`
		FormOf []target `json:"form_of"`
		AltOf  []target `json:"alt_of"`
	} `json:"senses"`
	Sounds []sound `json:"sounds"`
	Forms  []struct {
		Form string   `json:"form"`
		Tags []string `json:"tags"`
	} `json:"forms"`
}

// number is an integer that Wiktextract writes as a number on most lines and
// as a string ("1") on some.
type number int

func (n *number) UnmarshalJSON(data []byte) error {
	value, err := strconv.Atoi(strings.Trim(string(data), `"`))
	if err != nil {
		return fmt.Errorf("%s is not a whole number", data)
	}
	*n = number(value)
	return nil
}

type target struct {
	Word string `json:"word"`
}

type sound struct {
	IPA  string   `json:"ipa"`
	Tags []string `json:"tags"`
}

type entry struct {
	word, key, pos string
	etymology      *number
	ipaUS, ipaUK   string // empty: none
	senses         []sense
}

type sense struct {
	gloss, tags string
	examples    []string
}

type formRow struct {
	key, lemma, lemmaKey, tags string
}

type formIPA struct {
	key, pos, ipaUS, ipaUK string
}

// converted is what one English line contributes to the file.
type converted struct {
	entry   *entry // nil when no sense is left or the key is empty
	forms   []formRow
	formIPA *formIPA
}

var oldTags = []string{"archaic", "obsolete", "historical"}

var skippedFormTags = append([]string{"table-tags", "inflection-template", "class", "romanization", "canonical"}, oldTags...)

func hasAny(tags, of []string) bool {
	return slices.ContainsFunc(tags, func(t string) bool { return slices.Contains(of, t) })
}

func convert(w wiktextractEntry) converted {
	var c converted
	addForm := func(form, lemma string, tags []string) bool {
		row := formRow{wordform.Key(form), lemma, wordform.Key(lemma), strings.Join(tags, " ")}
		if row.key == "" || row.lemmaKey == "" {
			return false
		}
		c.forms = append(c.forms, row)
		return true
	}

	var senses []sense
	madeFormOf := false
	for _, s := range w.Senses {
		if hasAny(s.Tags, oldTags) || len(s.Glosses) == 0 {
			continue
		}
		if targets := slices.Concat(s.FormOf, s.AltOf); len(targets) > 0 {
			for _, t := range targets {
				if addForm(w.Word, t.Word, s.Tags) {
					madeFormOf = true
				}
			}
			continue
		}
		kept := sense{gloss: s.Glosses[len(s.Glosses)-1], tags: strings.Join(s.Tags, " ")}
		for _, x := range s.Examples {
			if x.Ref == "" && x.Type != "quotation" {
				kept.examples = append(kept.examples, x.Text)
			}
		}
		senses = append(senses, kept)
	}

	for _, f := range w.Forms {
		if f.Form != w.Word && !hasAny(f.Tags, skippedFormTags) {
			addForm(f.Form, w.Word, f.Tags)
		}
	}

	key := wordform.Key(w.Word)
	if key == "" {
		return c
	}
	ipaUS, ipaUK := pickIPA(w.Sounds)
	switch {
	case len(senses) > 0:
		c.entry = &entry{w.Word, key, w.Pos, w.EtymologyNumber, ipaUS, ipaUK, senses}
	case madeFormOf && (ipaUS != "" || ipaUK != ""):
		c.formIPA = &formIPA{key, w.Pos, ipaUS, ipaUK}
	}
	return c
}

// pickIPA returns the first American and the first British IPA. With neither,
// the first untagged one counts as American.
func pickIPA(sounds []sound) (us, uk string) {
	var untagged string
	for _, s := range sounds {
		if s.IPA == "" {
			continue
		}
		if us == "" && hasAny(s.Tags, []string{"US", "General-American"}) {
			us = s.IPA
		}
		if uk == "" && hasAny(s.Tags, []string{"UK", "Received-Pronunciation"}) {
			uk = s.IPA
		}
		if untagged == "" && len(s.Tags) == 0 {
			untagged = s.IPA
		}
	}
	if us == "" && uk == "" {
		us = untagged
	}
	return us, uk
}

// ecdictPos maps ECDICT's part-of-speech codes to Wiktextract's names.
var ecdictPos = map[string]string{"n": "noun", "v": "verb", "j": "adj", "r": "adv"}

// posShares reads ECDICT's pos field ("n:15/v:85") into a share per
// Wiktextract part of speech. Other codes are left out.
func posShares(field string) map[string]float64 {
	shares := map[string]float64{}
	for _, part := range strings.Split(field, "/") {
		code, number, ok := strings.Cut(part, ":")
		pos := ecdictPos[code]
		share, err := strconv.ParseFloat(number, 64)
		if ok && pos != "" && err == nil {
			shares[pos] = share
		}
	}
	return shares
}
