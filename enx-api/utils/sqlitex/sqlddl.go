package sqlitex

import (
	"errors"
	"fmt"
	"strings"
)

// A small SQLite tokenizer, enough to rewrite a CREATE TABLE statement
// without disturbing anything it does not understand: every byte of the
// input lands in exactly one token, so joining the kept tokens reproduces the
// original text.

type tokenKind int

const (
	tokSpace tokenKind = iota
	tokComment
	tokWord        // bare word: keyword or identifier
	tokQuotedIdent // "x", `x` or [x]
	tokString      // 'x'
	tokPunct
)

type sqlToken struct {
	kind tokenKind
	text string
}

func (t sqlToken) significant() bool { return t.kind != tokSpace && t.kind != tokComment }

func (t sqlToken) isIdent() bool { return t.kind == tokWord || t.kind == tokQuotedIdent }

// ident is the identifier's name, unquoted and lower-cased (SQLite compares
// identifiers case-insensitively).
func (t sqlToken) ident() string {
	s := t.text
	switch t.kind {
	case tokQuotedIdent:
		switch s[0] {
		case '"':
			s = strings.ReplaceAll(s[1:len(s)-1], `""`, `"`)
		case '`':
			s = strings.ReplaceAll(s[1:len(s)-1], "``", "`")
		case '[':
			s = s[1 : len(s)-1]
		}
	case tokWord:
	default:
		return ""
	}
	return strings.ToLower(s)
}

// is reports whether t is the bare keyword kw.
func (t sqlToken) is(kw string) bool { return t.kind == tokWord && strings.EqualFold(t.text, kw) }

func (t sqlToken) isPunct(p string) bool { return t.kind == tokPunct && t.text == p }

// tokenizeSQL splits sql into tokens. An unterminated quote or comment runs
// to the end of the input as one token.
func tokenizeSQL(sql string) []sqlToken {
	var out []sqlToken
	for i := 0; i < len(sql); {
		c := sql[i]
		start := i
		var kind tokenKind
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f':
			for i < len(sql) && strings.IndexByte(" \t\n\r\f", sql[i]) >= 0 {
				i++
			}
			kind = tokSpace
		case c == '-' && i+1 < len(sql) && sql[i+1] == '-':
			if end := strings.IndexByte(sql[i:], '\n'); end >= 0 {
				i += end
			} else {
				i = len(sql)
			}
			kind = tokComment
		case c == '/' && i+1 < len(sql) && sql[i+1] == '*':
			if end := strings.Index(sql[i+2:], "*/"); end >= 0 {
				i += 2 + end + 2
			} else {
				i = len(sql)
			}
			kind = tokComment
		case c == '\'' || c == '"' || c == '`':
			i = endOfQuoted(sql, i, c)
			kind = tokQuotedIdent
			if c == '\'' {
				kind = tokString
			}
		case c == '[':
			if end := strings.IndexByte(sql[i:], ']'); end >= 0 {
				i += end + 1
			} else {
				i = len(sql)
			}
			kind = tokQuotedIdent
		case isWordByte(c):
			for i < len(sql) && isWordByte(sql[i]) {
				i++
			}
			kind = tokWord
		default:
			i++
			kind = tokPunct
		}
		out = append(out, sqlToken{kind: kind, text: sql[start:i]})
	}
	return out
}

// endOfQuoted returns the index just past the quote that closes the one at
// i; a doubled quote is an escaped one.
func endOfQuoted(sql string, i int, q byte) int {
	for j := i + 1; j < len(sql); j++ {
		if sql[j] != q {
			continue
		}
		if j+1 < len(sql) && sql[j+1] == q {
			j++
			continue
		}
		return j + 1
	}
	return len(sql)
}

func isWordByte(c byte) bool {
	return c == '_' || c == '$' || c >= 0x80 ||
		(c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
}

// significantIdx lists the positions of toks[from:to] that are not space or
// comments.
func significantIdx(toks []sqlToken, from, to int) []int {
	var out []int
	for i := from; i < to; i++ {
		if toks[i].significant() {
			out = append(out, i)
		}
	}
	return out
}

// rewriteUsersDDL turns the live CREATE TABLE users statement into one that
// creates newName with the same columns and constraints, minus single-column
// UNIQUE on email or name: a column constraint (`email TEXT UNIQUE`,
// `CONSTRAINT x UNIQUE ON CONFLICT ...`) or a table constraint
// (`[CONSTRAINT x] UNIQUE (email)`). Everything else keeps its original text.
// It refuses what it does not recognise rather than guess.
func rewriteUsersDDL(ddl, newName string) (string, error) {
	toks := tokenizeSQL(ddl)
	sig := significantIdx(toks, 0, len(toks))

	// CREATE [TEMP|TEMPORARY] TABLE [IF NOT EXISTS] [schema.]name ( ... ) tail
	k := 0
	next := func() (sqlToken, bool) {
		if k >= len(sig) {
			return sqlToken{}, false
		}
		t := toks[sig[k]]
		k++
		return t, true
	}
	if t, ok := next(); !ok || !t.is("create") {
		return "", errors.New("users DDL does not start with CREATE")
	}
	t, _ := next()
	if t.is("temp") || t.is("temporary") {
		t, _ = next()
	}
	if !t.is("table") {
		return "", errors.New("users DDL is not CREATE TABLE")
	}
	t, _ = next()
	if t.is("if") {
		if n, _ := next(); !n.is("not") {
			return "", errors.New("users DDL: malformed IF NOT EXISTS")
		}
		if e, _ := next(); !e.is("exists") {
			return "", errors.New("users DDL: malformed IF NOT EXISTS")
		}
		t, _ = next()
	}
	if !t.isIdent() {
		return "", errors.New("users DDL: no table name")
	}
	if k < len(sig) && toks[sig[k]].isPunct(".") {
		k++
		if n, ok := next(); !ok || !n.isIdent() {
			return "", errors.New("users DDL: malformed schema-qualified name")
		}
	}
	if k >= len(sig) || !toks[sig[k]].isPunct("(") {
		return "", errors.New("users DDL: no column list (CREATE TABLE ... AS SELECT is not supported)")
	}
	open := sig[k]
	closeAt, err := matchingParen(toks, open)
	if err != nil {
		return "", err
	}

	// Split the column list at top-level commas.
	type def struct{ from, to, comma int } // comma: index of the comma before it, or -1
	var defs []def
	depth, from, comma := 0, open+1, -1
	for i := open + 1; i < closeAt; i++ {
		switch {
		case toks[i].isPunct("("):
			depth++
		case toks[i].isPunct(")"):
			depth--
		case toks[i].isPunct(",") && depth == 0:
			defs = append(defs, def{from, i, comma})
			from, comma = i+1, i
		}
	}
	defs = append(defs, def{from, closeAt, comma})

	drop := make([]bool, len(toks))
	for _, d := range defs {
		ds := significantIdx(toks, d.from, d.to)
		if len(ds) == 0 {
			return "", errors.New("users DDL: empty definition in the column list")
		}
		first := toks[ds[0]]
		if first.is("constraint") || first.is("primary") || first.is("unique") || first.is("check") || first.is("foreign") {
			remove, err := isProfileUniqueTableConstraint(toks, ds)
			if err != nil {
				return "", err
			}
			if remove {
				if d.comma < 0 {
					return "", errors.New("users DDL: a table constraint comes first")
				}
				for i := d.comma; i < d.to; i++ {
					drop[i] = true
				}
			}
			continue
		}
		if !first.isIdent() || !profileColumns[first.ident()] {
			continue
		}
		if err := dropColumnUnique(toks, ds, drop); err != nil {
			return "", err
		}
	}

	var b strings.Builder
	b.WriteString("CREATE TABLE ")
	b.WriteString(quoteIdent(newName))
	b.WriteString(" (")
	for i := open + 1; i < closeAt; i++ {
		if !drop[i] {
			b.WriteString(toks[i].text)
		}
	}
	for i := closeAt; i < len(toks); i++ {
		b.WriteString(toks[i].text)
	}
	return b.String(), nil
}

func matchingParen(toks []sqlToken, open int) (int, error) {
	depth := 0
	for i := open; i < len(toks); i++ {
		switch {
		case toks[i].isPunct("("):
			depth++
		case toks[i].isPunct(")"):
			depth--
			if depth == 0 {
				return i, nil
			}
		}
	}
	return 0, errors.New("users DDL: unbalanced parentheses")
}

// isProfileUniqueTableConstraint reports whether the table constraint at ds
// is `[CONSTRAINT name] UNIQUE (col [COLLATE c] [ASC|DESC]) [ON CONFLICT r]`
// with col email or name.
func isProfileUniqueTableConstraint(toks []sqlToken, ds []int) (bool, error) {
	s := make([]sqlToken, len(ds))
	for i, p := range ds {
		s[i] = toks[p]
	}
	if s[0].is("constraint") {
		if len(s) < 2 || !s[1].isIdent() {
			return false, errors.New("users DDL: CONSTRAINT without a name")
		}
		s = s[2:]
	}
	if len(s) == 0 || !s[0].is("unique") {
		return false, nil
	}
	if len(s) < 2 || !s[1].isPunct("(") {
		return false, errors.New("users DDL: UNIQUE table constraint without a column list")
	}
	end := -1
	for i := 2; i < len(s); i++ {
		if s[i].isPunct("(") {
			// An expression in the key: not a plain column list.
			return false, mentionsProfileColumn(s, "UNIQUE constraint with an expression")
		}
		if s[i].isPunct(")") {
			end = i
			break
		}
	}
	if end < 0 {
		return false, errors.New("users DDL: unterminated UNIQUE column list")
	}
	key := s[2:end]
	for _, t := range key {
		if t.isPunct(",") {
			return false, nil // composite: not ours, kept as it is
		}
	}
	if len(key) == 0 || !key[0].isIdent() || !profileColumns[key[0].ident()] {
		return false, nil
	}
	if !onlyKeyModifiers(key[1:]) {
		return false, fmt.Errorf("users DDL: cannot read UNIQUE key %q", joinTokens(key))
	}
	if !onlyConflictClause(s[end+1:]) {
		return false, fmt.Errorf("users DDL: cannot read what follows UNIQUE (%s)", joinTokens(key))
	}
	return true, nil
}

// dropColumnUnique marks for removal every `[CONSTRAINT name] UNIQUE
// [ON CONFLICT r]` among the column definition's top-level constraints.
func dropColumnUnique(toks []sqlToken, ds []int, drop []bool) error {
	depth := 0
	for j := 1; j < len(ds); j++ {
		t := toks[ds[j]]
		switch {
		case t.isPunct("("):
			depth++
			continue
		case t.isPunct(")"):
			depth--
			continue
		}
		if depth != 0 || !t.is("unique") {
			continue
		}
		start, end := ds[j], ds[j]+1
		if j >= 3 && toks[ds[j-2]].is("constraint") && toks[ds[j-1]].isIdent() {
			start = ds[j-2]
		}
		if j+3 < len(ds) && toks[ds[j+1]].is("on") && toks[ds[j+2]].is("conflict") {
			if !isConflictResolution(toks[ds[j+3]]) {
				return errors.New("users DDL: unknown ON CONFLICT resolution")
			}
			end = ds[j+3] + 1
		} else if j+1 < len(ds) && toks[ds[j+1]].is("on") {
			return errors.New("users DDL: cannot read ON after UNIQUE")
		}
		for i := start; i < end; i++ {
			drop[i] = true
		}
	}
	return nil
}

func onlyKeyModifiers(ts []sqlToken) bool {
	for i := 0; i < len(ts); i++ {
		switch {
		case ts[i].is("asc") || ts[i].is("desc"):
		case ts[i].is("collate") && i+1 < len(ts) && ts[i+1].isIdent():
			i++
		default:
			return false
		}
	}
	return true
}

func onlyConflictClause(ts []sqlToken) bool {
	if len(ts) == 0 {
		return true
	}
	return len(ts) == 3 && ts[0].is("on") && ts[1].is("conflict") && isConflictResolution(ts[2])
}

func isConflictResolution(t sqlToken) bool {
	for _, r := range []string{"rollback", "abort", "fail", "ignore", "replace"} {
		if t.is(r) {
			return true
		}
	}
	return false
}

func mentionsProfileColumn(ts []sqlToken, what string) error {
	for _, t := range ts {
		if t.isIdent() && profileColumns[t.ident()] {
			return fmt.Errorf("users DDL: %s on a profile column: %q", what, joinTokens(ts))
		}
	}
	return nil
}

func joinTokens(ts []sqlToken) string {
	parts := make([]string, len(ts))
	for i, t := range ts {
		parts[i] = t.text
	}
	return strings.Join(parts, " ")
}
