-- Expression index to speed up the case-insensitive fallback lookup in
-- repo.GetWordByEnglish (WHERE LOWER(english) = LOWER(?)). `english` itself
-- stays case-sensitive in storage; this only indexes the LOWER() expression.
-- Applied automatically at startup via sqlitex.Init(), this file documents
-- the equivalent statement for manual/reference use.

CREATE INDEX IF NOT EXISTS idx_words_english_lower ON words(LOWER(english));
