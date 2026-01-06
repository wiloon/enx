#!/bin/bash
# Compare word IDs between local and remote database

LOCAL_DB="/var/lib/enx-api/enx.db"
REMOTE_HOST="192.168.50.190"
REMOTE_DB="/var/lib/enx-api/enx.db"

echo "🔍 Comparing databases..."
echo ""

# Get local IDs
echo "Fetching local word IDs..."
sqlite3 "$LOCAL_DB" "SELECT id FROM words ORDER BY id" > /tmp/local_ids.txt
LOCAL_COUNT=$(wc -l < /tmp/local_ids.txt)
echo "Local: $LOCAL_COUNT words"

# Get remote IDs
echo "Fetching remote word IDs from $REMOTE_HOST..."
ssh "$REMOTE_HOST" "sqlite3 $REMOTE_DB 'SELECT id FROM words ORDER BY id'" > /tmp/remote_ids.txt
REMOTE_COUNT=$(wc -l < /tmp/remote_ids.txt)
echo "Remote: $REMOTE_COUNT words"

echo ""
echo "📊 Differences:"
echo ""

# Find IDs only in remote (missing locally)
echo "Words only in REMOTE (missing locally):"
comm -13 /tmp/local_ids.txt /tmp/remote_ids.txt > /tmp/missing_local.txt
MISSING_LOCAL=$(wc -l < /tmp/missing_local.txt)
echo "Count: $MISSING_LOCAL"
if [ $MISSING_LOCAL -gt 0 ]; then
    head -20 /tmp/missing_local.txt | while read id; do
        ssh "$REMOTE_HOST" "sqlite3 $REMOTE_DB \"SELECT id, english, updated_at FROM words WHERE id='$id'\""
    done
fi

echo ""

# Find IDs only in local (missing remotely)
echo "Words only in LOCAL (missing remotely):"
comm -23 /tmp/local_ids.txt /tmp/remote_ids.txt > /tmp/missing_remote.txt
MISSING_REMOTE=$(wc -l < /tmp/missing_remote.txt)
echo "Count: $MISSING_REMOTE"
if [ $MISSING_REMOTE -gt 0 ]; then
    head -20 /tmp/missing_remote.txt | while read id; do
        sqlite3 "$LOCAL_DB" "SELECT id, english, updated_at FROM words WHERE id='$id'"
    done
fi

echo ""
echo "✅ Comparison complete"
echo "Difference: $((REMOTE_COUNT - LOCAL_COUNT)) records"
