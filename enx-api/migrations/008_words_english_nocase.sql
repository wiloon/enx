-- ADR-043: words.english becomes case-insensitive and unique, matching
-- ECDICT's stardict.word. SQLite can't change a column's collation in place,
-- and case-variant rows ("US", "us") would violate the new unique index, so
-- the migration clears words and user_dicts (the only table referencing
-- words.id) and recreates words. Nothing else is touched; ECDICT is a
-- separate, read-only file.
--
-- Applied automatically at startup by sqlitex.migrateWordsEnglishNoCase()
-- (the table is then recreated by AutoMigrate from the Word model). This file
-- documents the equivalent statements for manual/reference use.

BEGIN;
DELETE FROM user_dicts;
DROP TABLE words;
CREATE TABLE words (
    id TEXT PRIMARY KEY,
    english TEXT COLLATE NOCASE NOT NULL,
    chinese TEXT,
    pronunciation TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    load_count INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX idx_words_english ON words(english);
CREATE INDEX idx_words_deleted_at ON words(deleted_at);
COMMIT;
