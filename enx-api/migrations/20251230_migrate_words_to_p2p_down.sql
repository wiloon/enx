-- ============================================================================
-- Rollback: Revert words table from P2P schema to original schema
-- Date: 2025-12-30
-- Description: 
--   - Convert primary key from TEXT (UUID) back to INTEGER auto-increment
--   - Convert INTEGER timestamps back to datetime strings
--   - Remove deleted_at field
-- ============================================================================

-- WARNING: This will lose UUID information and may cause issues if P2P sync has already started!
-- Only use this if migration was just applied and you want to revert immediately.

BEGIN TRANSACTION;

-- Step 1: Create old-style words table
CREATE TABLE words_old (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    english TEXT NOT NULL,
    chinese TEXT,
    pronunciation TEXT,
    create_datetime DATETIME,
    load_count INTEGER NOT NULL DEFAULT 0,
    update_datetime DATETIME
);

-- Step 2: Migrate data back (WARNING: loses UUIDs, generates new auto-increment IDs)
INSERT INTO words_old (
    english,
    chinese,
    pronunciation,
    create_datetime,
    load_count,
    update_datetime
)
SELECT 
    english,
    chinese,
    pronunciation,
    
    -- Convert Unix timestamp back to datetime string
    CASE 
        WHEN create_datetime IS NOT NULL 
        THEN datetime(create_datetime/1000, 'unixepoch')
        ELSE NULL
    END as create_datetime,
    
    load_count,
    
    -- Convert Unix timestamp back to datetime string
    CASE 
        WHEN update_datetime IS NOT NULL 
        THEN datetime(update_datetime/1000, 'unixepoch')
        ELSE datetime('now')
    END as update_datetime
    
FROM words
WHERE deleted_at IS NULL;  -- Only restore non-deleted records

-- Step 3: Drop new table
DROP TABLE words;

-- Step 4: Rename old table
ALTER TABLE words_old RENAME TO words;

-- Step 5: Recreate original index
CREATE UNIQUE INDEX idx_english ON words(english);

COMMIT;

-- ============================================================================
-- Note: After rollback, you will lose:
-- - Original UUID mappings
-- - Soft delete information (deleted records are permanently lost)
-- - Sync state (if any P2P sync was initiated)
-- ============================================================================
