CREATE TABLE IF NOT EXISTS words (
    id TEXT PRIMARY KEY,          -- UUID
    english TEXT NOT NULL,
    chinese TEXT,
    phonetic TEXT,
    definition TEXT,
    update_datetime TEXT NOT NULL, -- ISO8601
    is_deleted INTEGER DEFAULT 0   -- 0: Active, 1: Deleted
);

CREATE INDEX IF NOT EXISTS idx_words_update_datetime ON words(update_datetime);
