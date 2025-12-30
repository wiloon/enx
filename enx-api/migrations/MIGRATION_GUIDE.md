# Words Table Migration Quick Reference

## 📋 Current Status

**Database**: `/Users/wiloon/workspace/projects/enx/enx-api/enx.db`  
**Table**: `words`  
**Records**: 3 words  
**Current Schema**: INTEGER auto-increment (not P2P compatible)

## 🎯 Migration Goal

Convert `words` table to support P2P synchronization:
- ✅ UUID primary keys (no ID conflicts)
- ✅ Unix timestamp fields (milliseconds)
- ✅ Soft delete support (`deleted_at`)

## 🚀 Quick Start

### Option 1: Test First (Recommended)

```bash
cd /Users/wiloon/workspace/projects/enx/enx-api

# Run automated test
./migrations/test_migration.sh

# If successful, apply to real database
cp enx.db enx.db.backup-$(date +%Y%m%d)
sqlite3 enx.db < migrations/20251230_migrate_words_to_p2p.sql
```

### Option 2: Direct Apply

```bash
cd /Users/wiloon/workspace/projects/enx/enx-api

# Backup
cp enx.db enx.db.backup-$(date +%Y%m%d)

# Apply migration
sqlite3 enx.db < migrations/20251230_migrate_words_to_p2p.sql

# Verify
sqlite3 enx.db "SELECT COUNT(*) FROM words;"  # Should output: 3
```

## 📊 Schema Changes

### Before (Current)
```sql
CREATE TABLE words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- ❌ Conflicts in P2P
    english TEXT NOT NULL,
    chinese TEXT,
    pronunciation TEXT,
    create_datetime DATETIME,              -- ❌ Not standardized
    load_count INTEGER DEFAULT 0,
    update_datetime DATETIME               -- ❌ Not standardized
);
```

### After (P2P Compatible)
```sql
CREATE TABLE words (
    id TEXT PRIMARY KEY,                   -- ✅ UUID (e.g., "a1b2c3d4-...")
    english TEXT NOT NULL,
    chinese TEXT,
    pronunciation TEXT,
    create_datetime INTEGER,               -- ✅ Unix timestamp (ms)
    load_count INTEGER DEFAULT 0,
    update_datetime INTEGER NOT NULL,      -- ✅ Unix timestamp (ms)
    deleted_at INTEGER                     -- ✅ Soft delete support
);
```

## 🔍 Verification Queries

```bash
# Check schema
sqlite3 enx.db ".schema words"

# Count records (should be 3)
sqlite3 enx.db "SELECT COUNT(*) FROM words;"

# View sample data
sqlite3 enx.db <<EOF
SELECT 
    substr(id, 1, 13) as id_preview,
    english,
    datetime(update_datetime/1000, 'unixepoch') as last_update,
    deleted_at
FROM words;
EOF
```

Expected output:
```
id_preview   |english   |last_update         |deleted_at
-------------|----------|--------------------|----------
a1b2c3d4-... |test      |2025-11-05 01:39:07 |
e5f6a7b8-... |entropy   |2025-11-10 02:14:54 |
c9d0e1f2-... |hydration |2025-11-12 04:04:19 |
```

## 🔄 Rollback (If Needed)

⚠️ **Warning**: Rollback will lose UUID mappings and soft delete data!

```bash
cd /Users/wiloon/workspace/projects/enx/enx-api

# Restore from backup (safer)
cp enx.db.backup-YYYYMMDD enx.db

# Or use rollback script
sqlite3 enx.db < migrations/20251230_migrate_words_to_p2p_down.sql
```

## ⚠️ Important Notes

1. **Backup is mandatory**: Always backup before migration
2. **No data loss**: Migration preserves all 3 words
3. **UUID generation**: Each word gets a unique UUID
4. **Timestamp conversion**: Datetime strings → Unix milliseconds
5. **Soft delete**: All records start with `deleted_at = NULL`

## 🐛 Troubleshooting

### Migration fails with "no records"
```bash
# Check if table has data
sqlite3 enx.db "SELECT * FROM words;"

# If empty, restore backup and investigate
```

### Timestamps look wrong
```bash
# Check timestamp conversion
sqlite3 enx.db <<EOF
SELECT 
    english,
    update_datetime as raw_timestamp,
    datetime(update_datetime/1000, 'unixepoch') as readable_time
FROM words;
EOF

# Should show dates around Nov 2025
```

### UUIDs don't look right
```bash
# Check UUID format (should be 36 chars with dashes)
sqlite3 enx.db "SELECT id, length(id) as id_length FROM words;"

# Valid UUID: "a1b2c3d4-e5f6-4789-a012-3456789abcde" (36 chars)
```

## 📚 Related Files

- **Migration script**: `migrations/20251230_migrate_words_to_p2p.sql`
- **Rollback script**: `migrations/20251230_migrate_words_to_p2p_down.sql`
- **Test script**: `migrations/test_migration.sh`
- **Documentation**: `migrations/README.md`

## ✅ Success Criteria

After migration:
- ✅ 3 records still exist
- ✅ Each has a valid UUID (36 characters with dashes)
- ✅ `update_datetime` is Unix timestamp in milliseconds
- ✅ `deleted_at` is NULL for all records
- ✅ Can query by english (unique index preserved)

---

**Next Steps**: After successful migration, proceed to Phase 1 of P2P implementation (build data service).
