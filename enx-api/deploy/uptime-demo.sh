#!/bin/bash

# Demo script to show different uptime formats
# This script demonstrates the uptime formatting logic

set -e

echo "=== Uptime Format Demo ==="
echo ""

# Function to simulate uptime formatting
format_uptime() {
    local duration_ms=$1
    local duration=$(echo "scale=3; $duration_ms / 1000" | bc)
    
    if (( duration_ms < 1000 )); then
        echo "${duration_ms}ms"
    elif (( duration_ms < 60000 )); then
        local seconds=$((duration_ms / 1000))
        local ms=$((duration_ms % 1000))
        echo "${seconds}s ${ms}ms"
    elif (( duration_ms < 3600000 )); then
        local minutes=$((duration_ms / 60000))
        local seconds=$(((duration_ms % 60000) / 1000))
        echo "${minutes}m ${seconds}s"
    elif (( duration_ms < 86400000 )); then
        local hours=$((duration_ms / 3600000))
        local minutes=$(((duration_ms % 3600000) / 60000))
        local seconds=$(((duration_ms % 60000) / 1000))
        echo "${hours}h ${minutes}m ${seconds}s"
    else
        local days=$((duration_ms / 86400000))
        local hours=$(((duration_ms % 86400000) / 3600000))
        local minutes=$(((duration_ms % 3600000) / 60000))
        local seconds=$(((duration_ms % 60000) / 1000))
        echo "${days}d ${hours}h ${minutes}m ${seconds}s"
    fi
}

echo "1. Short durations (milliseconds precision):"
echo "   500ms  -> $(format_uptime 500)"
echo "   1500ms -> $(format_uptime 1500)"
echo "   30000ms -> $(format_uptime 30000)"
echo ""

echo "2. Medium durations (seconds precision):"
echo "   90000ms  -> $(format_uptime 90000)"
echo "   150000ms -> $(format_uptime 150000)"
echo "   1800000ms -> $(format_uptime 1800000)"
echo ""

echo "3. Long durations (seconds precision):"
echo "   7200000ms   -> $(format_uptime 7200000)"
echo "   8100000ms   -> $(format_uptime 8100000)"
echo "   86400000ms  -> $(format_uptime 86400000)"
echo ""

echo "4. Very long durations (days):"
echo "   90000000ms  -> $(format_uptime 90000000)"
echo "   172800000ms -> $(format_uptime 172800000)"
echo ""

echo "5. Real-world examples:"
echo "   Application just started: $(format_uptime 500)"
echo "   After 1 minute: $(format_uptime 60000)"
echo "   After 1 hour: $(format_uptime 3600000)"
echo "   After 1 day: $(format_uptime 86400000)"
echo "   After 1 week: $(format_uptime 604800000)"
echo ""

echo "6. Precision rules:"
echo "   < 1 second:    Shows milliseconds (e.g., 500ms)"
echo "   < 1 minute:    Shows seconds with milliseconds (e.g., 30s 500ms)"
echo "   < 1 hour:      Shows minutes and seconds (e.g., 45m 30s)"
echo "   < 1 day:       Shows hours, minutes, and seconds (e.g., 2h 15m 30s)"
echo "   ≥ 1 day:       Shows days, hours, minutes, and seconds (e.g., 1d 3h 20m 15s)"
echo ""

echo "=== Demo completed ==="
echo "The actual API uses Go's time.Duration formatting for precise calculations."
echo "This demo shows the expected output format for different uptime durations." 