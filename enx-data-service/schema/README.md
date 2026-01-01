# Database Schema

## Overview

This directory contains SQL schema definitions for the data-service database.

## Files

- `words.sql` - Words table schema (P2P-compatible with UUID primary key)

## Usage

### For New Node Setup

Run the schema file on a new node before starting data-service:

```bash
# SQLite
sqlite3 /var/lib/enx-api/enx.db < schema/words.sql

# Or use the data-service migrate command (if implemented)
./bin/server migrate --db /var/lib/enx-api/enx.db
```

### Schema Features

**words table:**
- UUID-based primary keys (P2P compatible)
- Unix millisecond timestamps for sync
- Soft delete support (deleted_at field)
- Case-insensitive unique constraint on english field
- Optimized indexes for queries and sync

## Migration from Legacy Schema

If you have an existing database with INTEGER id, use the migration script:

```bash
cd ../enx-api/migrations
./test_migration.sh
```

## Notes

- Always backup your database before running schema changes
- All nodes must have the same schema version
- The schema is designed for P2P synchronization
