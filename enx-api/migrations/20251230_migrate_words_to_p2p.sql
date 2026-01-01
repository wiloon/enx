-- ============================================================================
-- Migration: Migrate words table to support P2P synchronization
-- Date: 2025-12-30
-- Description: 
--   - Convert primary key from INTEGER auto-increment to TEXT (UUID)
--   - Convert datetime fields to INTEGER (Unix timestamp in milliseconds)
--   - Add deleted_at field for soft delete support
--   - Preserve existing data
-- ============================================================================

-- IMPORTANT: Backup your database before running this migration!
-- cp enx.db enx.db.backup-$(date +%Y%m%d)

BEGIN TRANSACTION;

-- Step 1: Create new words table with P2P-compatible schema
CREATE TABLE words_new (
    id TEXT PRIMARY KEY,                    -- UUID instead of auto-increment
    english TEXT NOT NULL,                   -- Original field
    chinese TEXT,                            -- Original field
    pronunciation TEXT,                      -- Original field
    created_at INTEGER,                      -- Unix timestamp in milliseconds (when record was created)
    load_count INTEGER NOT NULL DEFAULT 0,   -- Original field
    updated_at INTEGER NOT NULL,             -- Unix timestamp in milliseconds (required for sync)
    deleted_at INTEGER                       -- Soft delete timestamp (NULL = not deleted)
);

-- Step 2: Migrate existing data from old table to new table
-- Generate UUIDs and convert timestamps
-- Note: If duplicate english values exist, keep only the one with latest update_datetime (or highest id if timestamps are equal)
INSERT INTO words_new (
    id,
    english,
    chinese,
    pronunciation,
    created_at,
    load_count,
    updated_at,
    deleted_at
)
SELECT 
    -- Generate UUID v4 (random UUID)
    lower(
        hex(randomblob(4)) || '-' || 
        hex(randomblob(2)) || '-' || 
        '4' || substr(hex(randomblob(2)), 2) || '-' || 
        substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || 
        hex(randomblob(6))
    ) as id,
    
    english,
    chinese,
    pronunciation,
    
    -- Convert create_datetime string to Unix timestamp (milliseconds)
    CASE 
        WHEN create_datetime IS NOT NULL AND create_datetime != ''
        THEN CAST((julianday(create_datetime) - 2440587.5) * 86400.0 * 1000 AS INTEGER)
        ELSE CAST((julianday('now') - 2440587.5) * 86400.0 * 1000 AS INTEGER)
    END as created_at,
    
    load_count,
    
    -- Convert update_datetime (required field, cannot be NULL)
    CASE 
        WHEN update_datetime IS NOT NULL AND update_datetime != ''
        THEN CAST((julianday(update_datetime) - 2440587.5) * 86400.0 * 1000 AS INTEGER)
        ELSE CAST((julianday('now') - 2440587.5) * 86400.0 * 1000 AS INTEGER)
    END as updated_at,
    
    NULL as deleted_at  -- Initially all records are not deleted
FROM words
WHERE id IN (
    -- For duplicate english values, keep only the record with:
    -- 1. Latest update_datetime (treat NULL as '1970-01-01' for comparison)
    -- 2. If timestamps are equal, keep the one with highest id
    SELECT id FROM words w1
    WHERE w1.id = (
        SELECT w2.id
        FROM words w2
        WHERE w2.english = w1.english
        ORDER BY 
            COALESCE(w2.update_datetime, '1970-01-01') DESC,
            w2.id DESC
        LIMIT 1
    )
);

-- Step 3: Drop old table
DROP TABLE words;

-- Step 4: Rename new table to original name
ALTER TABLE words_new RENAME TO words;

-- Step 5: Recreate indexes
CREATE UNIQUE INDEX idx_english ON words(english);
CREATE INDEX idx_words_updated_at ON words(updated_at);
CREATE INDEX idx_words_deleted_at ON words(deleted_at) WHERE deleted_at IS NOT NULL;

COMMIT;

-- Step 6: Verify migration (run this after commit to check success)
-- Expected: Should return the count of migrated records (3 for current data)
SELECT COUNT(*) as migrated_records FROM words;

-- ============================================================================
-- Verification queries (run these manually after migration)
-- ============================================================================

-- Check table schema
-- .schema words

-- Count records (should be 3)
-- SELECT COUNT(*) FROM words;

-- View sample data
-- SELECT 
--     substr(id, 1, 8) || '...' as id_preview,
--     english,
--     datetime(updated_at/1000, 'unixepoch') as update_time_readable,
--     deleted_at
-- FROM words;

-- ============================================================================
-- Expected output after migration:
-- 
-- Table schema:
-- CREATE TABLE words (
--     id TEXT PRIMARY KEY,
--     english TEXT NOT NULL,
--     chinese TEXT,
--     pronunciation TEXT,
--     created_at INTEGER,
--     load_count INTEGER NOT NULL DEFAULT 0,
--     updated_at INTEGER NOT NULL,
--     deleted_at INTEGER
-- );
--
-- All 3 words should have:
-- - UUID ids (e.g., "a1b2c3d4-e5f6-4789-a012-3456789abcdef")
-- - Timestamps in milliseconds (e.g., 1731129607945)
-- - deleted_at = NULL
-- ============================================================================
