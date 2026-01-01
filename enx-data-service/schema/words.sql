-- Words Table Schema for P2P Sync
-- This is the schema after migration from legacy INTEGER id to UUID-based P2P system
-- Run this SQL on any new node before starting data-service

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