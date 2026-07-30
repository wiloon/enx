-- One-time repair: words table DDL from 20251230_migrate_words_to_p2p.sql
-- embedded "-- ..." line comments inside CREATE TABLE. glebarez/sqlite
-- AutoMigrate rewrites that SQL and fails with "incomplete input", which
-- also blocked CREATE INDEX idx_words_english_lower at startup.
--
-- Applied automatically at startup via sqlitex.repairWordsTableDDLIfNeeded().
-- This file documents the equivalent statements for manual/reference use.

CREATE TABLE words__clean (
    id TEXT PRIMARY KEY,
    english TEXT NOT NULL,
    chinese TEXT,
    pronunciation TEXT,
    created_at INTEGER NOT NULL,
    load_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

INSERT INTO words__clean (id, english, chinese, pronunciation, created_at, load_count, updated_at, deleted_at)
SELECT id, english, chinese, pronunciation,
       COALESCE(created_at, updated_at, 0),
       COALESCE(load_count, 0),
       updated_at,
       deleted_at
FROM words;

DROP TABLE words;
ALTER TABLE words__clean RENAME TO words;

CREATE UNIQUE INDEX IF NOT EXISTS idx_english ON words(english);
CREATE INDEX IF NOT EXISTS idx_words_updated_at ON words(updated_at);
CREATE INDEX IF NOT EXISTS idx_words_deleted_at ON words(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_words_english_lower ON words(LOWER(english));
