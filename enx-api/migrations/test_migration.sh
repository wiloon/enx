#!/bin/bash
# Test migration on a copy of the database

set -e  # Exit on error

DB_PATH="/Users/wiloon/workspace/projects/enx/enx-api/enx.db"
TEST_DB="/tmp/enx_test.db"
MIGRATION_FILE="/Users/wiloon/workspace/projects/enx/enx-api/migrations/20251230_migrate_words_to_p2p.sql"

echo "🧪 Testing migration on a copy of the database..."
echo ""

# Step 1: Copy database to temp location
echo "📋 Step 1: Creating test database copy..."
cp "$DB_PATH" "$TEST_DB"
echo "✅ Test database created at: $TEST_DB"
echo ""

# Step 2: Show current schema
echo "📊 Step 2: Current schema (before migration):"
sqlite3 "$TEST_DB" ".schema words"
echo ""

# Step 3: Show current data
echo "📊 Step 3: Current data (before migration):"
sqlite3 "$TEST_DB" "SELECT id, english, create_datetime, update_datetime FROM words;"
echo ""

# Step 4: Run migration
echo "🔄 Step 4: Running migration..."
sqlite3 "$TEST_DB" < "$MIGRATION_FILE"
echo "✅ Migration completed"
echo ""

# Step 5: Show new schema
echo "📊 Step 5: New schema (after migration):"
sqlite3 "$TEST_DB" ".schema words"
echo ""

# Step 6: Show migrated data
echo "📊 Step 6: Migrated data (after migration):"
sqlite3 "$TEST_DB" <<EOF
SELECT 
    substr(id, 1, 8) || '...' as id_preview,
    english,
    created_at,
    updated_at,
    deleted_at
FROM words;
EOF
echo ""

# Step 7: Verify record count
echo "✅ Step 7: Verification"
BEFORE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM words;")
AFTER_COUNT=$(sqlite3 "$TEST_DB" "SELECT COUNT(*) FROM words;")

echo "Records before migration: $BEFORE_COUNT"
echo "Records after migration:  $AFTER_COUNT"

if [ "$BEFORE_COUNT" == "$AFTER_COUNT" ]; then
    echo "✅ Record count matches!"
else
    echo "❌ ERROR: Record count mismatch!"
    exit 1
fi

echo ""
echo "🎉 Test migration completed successfully!"
echo ""
echo "📍 Test database location: $TEST_DB"
echo "🗑️  To clean up: rm $TEST_DB"
echo ""
echo "⚠️  If everything looks good, apply to real database with:"
echo "   cd /Users/wiloon/workspace/projects/enx/enx-api"
echo "   cp enx.db enx.db.backup-\$(date +%Y%m%d)"
echo "   sqlite3 enx.db < migrations/20251230_migrate_words_to_p2p.sql"
