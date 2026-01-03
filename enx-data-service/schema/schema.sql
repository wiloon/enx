-- Data Service Schema
-- Contains sync-related tables for P2P sync
-- Note: Main tables (words, user_dicts) are defined in enx-api/schema.sql
-- since both services access the same database

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
