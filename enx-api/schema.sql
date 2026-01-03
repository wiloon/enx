CREATE TABLE users (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `name` varchar(256) NOT NULL,
  `email` varchar(256) NOT NULL,
  `password` varchar(256) NOT NULL,
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT NULL,
  `last_login_time` datetime DEFAULT NULL,
  UNIQUE (`name`),
  UNIQUE (`email`)
);

INSERT INTO users (id, name, email, password, create_time, update_time, last_login_time) 
VALUES (1, 'wiloon','wangyue@wiloon.com', 'password_1', '2025-05-02 13:14:32', NULL, NULL);

INSERT INTO users (id, name, email, password, create_time, update_time, last_login_time) 
VALUES (2, 'user_2','user_2@wiloon.com', 'password_2', '2025-05-02 13:15:32', NULL, NULL);

-- ==========================================
-- Words Table Schema for P2P Sync
-- This is the schema after migration from legacy INTEGER id to UUID-based P2P system
-- ==========================================

CREATE TABLE IF NOT EXISTS words (
    -- Primary key: UUID v4 for P2P compatibility
    id TEXT PRIMARY KEY,
    
    -- Word content
    english TEXT NOT NULL UNIQUE COLLATE NOCASE,
    chinese TEXT,
    pronunciation TEXT,
    
    -- Timestamps (Unix milliseconds for P2P sync)
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,  -- Soft delete: NULL = active, timestamp = deleted
    
    -- Query statistics
    load_count INTEGER DEFAULT 0
);

-- Index for soft delete queries (only active records)
CREATE INDEX IF NOT EXISTS idx_words_deleted_at 
ON words(deleted_at) 
WHERE deleted_at IS NULL;

-- Index for timestamp-based sync queries
CREATE INDEX IF NOT EXISTS idx_words_updated_at 
ON words(updated_at);

-- Index for english lookups (case insensitive)
CREATE INDEX IF NOT EXISTS idx_words_english 
ON words(english COLLATE NOCASE);

-- User Dictionary Table
-- Stores user-specific word data (query count, familiarity)
-- Supports P2P sync with UUID foreign keys
CREATE TABLE IF NOT EXISTS user_dicts (
    -- User identifier (UUID)
    user_id TEXT NOT NULL,
    
    -- Word identifier (UUID, references words.id)
    word_id TEXT NOT NULL,
    
    -- Query statistics
    query_count INTEGER DEFAULT 0,
    
    -- Familiarity flag: 0 = learning, 1 = already acquainted
    already_acquainted INTEGER DEFAULT 0,
    
    -- Timestamps (Unix milliseconds for P2P sync)
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    
    -- Composite primary key
    PRIMARY KEY (user_id, word_id)
);

-- Index for user-based queries
CREATE INDEX IF NOT EXISTS idx_user_dicts_user_id 
ON user_dicts(user_id);

-- Index for word-based queries
CREATE INDEX IF NOT EXISTS idx_user_dicts_word_id 
ON user_dicts(word_id);

-- Index for timestamp-based sync queries
CREATE INDEX IF NOT EXISTS idx_user_dicts_updated_at 
ON user_dicts(updated_at);

create table youdao
(
    english TEXT          not null,
    result  TEXT          not null,
    exist   INTEGER default 0 not null
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL
);

-- Sync State Table
-- Tracks last sync timestamp for each peer to avoid re-syncing unchanged data
CREATE TABLE IF NOT EXISTS sync_state (
    -- Peer identifier (address:port)
    peer_addr TEXT PRIMARY KEY,
    
    -- Last successful sync timestamp (Unix milliseconds)
    last_sync_time INTEGER NOT NULL,
    
    -- Last sync attempt timestamp
    updated_at INTEGER NOT NULL
);
