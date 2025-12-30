# Database Migrations

This directory contains SQL migration scripts for the ENX database.

## Naming Convention

Migrations follow the format: `YYYYMMDD_HHMMSS_description.sql`

Example: `20251230_100000_add_p2p_sync_support.sql`

## Migration Files

| File | Description | Date | Status |
|------|-------------|------|--------|
| `20251230_migrate_words_to_p2p.sql` | Migrate words table to support P2P sync (UUID + timestamps) | 2025-12-30 | Pending |

## How to Apply Migrations

### Manual Application
```bash
# Backup first!
cp enx.db enx.db.backup-$(date +%Y%m%d)

# Apply migration
sqlite3 enx.db < migrations/20251230_migrate_words_to_p2p.sql

# Verify
sqlite3 enx.db ".schema words"
```

### Using migrate tool
```bash
cd cmd/migrate
go run main.go
```

## Migration Checklist

Before applying a migration:
- [ ] Backup database
- [ ] Review SQL script carefully
- [ ] Test on a copy first
- [ ] Verify data integrity after migration

## Rollback

Each migration should have a corresponding rollback script if possible.
Format: `YYYYMMDD_HHMMSS_description_down.sql`
