CREATE TABLE `tbl_ecp` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `english` varchar(256) NOT NULL,
  `chinese` varchar(512) DEFAULT NULL,
  `pronunciation` varchar(256) DEFAULT NULL,
  `create_datetime` datetime DEFAULT NULL,
  `load_count` int(11) NOT NULL DEFAULT '0',
  `update_datetime` datetime DEFAULT NULL
);

CREATE TABLE `tbl_log` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `id_word` int(11) DEFAULT NULL,
  `log_type` varchar(128) DEFAULT NULL,
  `message` varchar(256) DEFAULT NULL,
  `create_datetime` datetime DEFAULT NULL
);

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

create table user_dicts
(
    user_id            INTEGER,
    word_id            INTEGER,
    query_count        INTEGER,
    already_acquainted INTEGER,
    update_time        datetime,
    PRIMARY KEY (user_id, word_id)
);

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
