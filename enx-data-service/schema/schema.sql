-- Data Service Schema
-- Contains sync-related tables and user data for P2P sync

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
