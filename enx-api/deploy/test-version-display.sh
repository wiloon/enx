#!/bin/bash

# Test script to demonstrate version display functionality
# This script simulates the version API call and display logic

set -e

echo "=== Testing Version Display Functionality ==="
echo ""

# Simulate a successful version API response
MOCK_VERSION_RESPONSE='{
  "success": true,
  "data": {
    "version": "1.0.0",
    "build_time": "2024-01-15_10:30:45_UTC",
    "git_commit": "3c3853cc619d53a2700b403eb176832dbd9b4c46",
    "git_branch": "main",
    "go_version": "go1.23.0",
    "uptime": "2h 15m 30s"
  },
  "message": "Version information retrieved successfully"
}'

echo "1. Testing with jq (if available):"
if command -v jq >/dev/null 2>&1; then
    echo "   jq is available, using jq for parsing"
    DEPLOYED_VERSION=$(echo "$MOCK_VERSION_RESPONSE" | jq -r '.data.version')
    DEPLOYED_COMMIT=$(echo "$MOCK_VERSION_RESPONSE" | jq -r '.data.git_commit')
    DEPLOYED_BRANCH=$(echo "$MOCK_VERSION_RESPONSE" | jq -r '.data.git_branch')
    DEPLOYED_BUILD_TIME=$(echo "$MOCK_VERSION_RESPONSE" | jq -r '.data.build_time')
    DEPLOYED_UPTIME=$(echo "$MOCK_VERSION_RESPONSE" | jq -r '.data.uptime')
    
    echo "   Version: $DEPLOYED_VERSION"
    echo "   Commit:  $DEPLOYED_COMMIT"
    echo "   Branch:  $DEPLOYED_BRANCH"
    echo "   Built:   $DEPLOYED_BUILD_TIME"
    echo "   Uptime:  $DEPLOYED_UPTIME"
else
    echo "   jq is not available, using grep fallback"
    DEPLOYED_VERSION=$(echo "$MOCK_VERSION_RESPONSE" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
    DEPLOYED_COMMIT=$(echo "$MOCK_VERSION_RESPONSE" | grep -o '"git_commit":"[^"]*"' | cut -d'"' -f4)
    DEPLOYED_BRANCH=$(echo "$MOCK_VERSION_RESPONSE" | grep -o '"git_branch":"[^"]*"' | cut -d'"' -f4)
    DEPLOYED_BUILD_TIME=$(echo "$MOCK_VERSION_RESPONSE" | grep -o '"build_time":"[^"]*"' | cut -d'"' -f4)
    DEPLOYED_UPTIME=$(echo "$MOCK_VERSION_RESPONSE" | grep -o '"uptime":"[^"]*"' | cut -d'"' -f4)
    
    echo "   Version: $DEPLOYED_VERSION"
    echo "   Commit:  $DEPLOYED_COMMIT"
    echo "   Branch:  $DEPLOYED_BRANCH"
    echo "   Built:   $DEPLOYED_BUILD_TIME"
    echo "   Uptime:  $DEPLOYED_UPTIME"
fi

echo ""

echo "2. Testing actual version API call (if service is running):"
TARGET_IP="192.168.50.36"
VERSION_RESPONSE=$(curl -s http://${TARGET_IP}:8080/version 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "   ✓ Version API is accessible"
    if command -v jq >/dev/null 2>&1; then
        ACTUAL_VERSION=$(echo "$VERSION_RESPONSE" | jq -r '.data.version')
        ACTUAL_COMMIT=$(echo "$VERSION_RESPONSE" | jq -r '.data.git_commit')
        ACTUAL_BRANCH=$(echo "$VERSION_RESPONSE" | jq -r '.data.git_branch')
        ACTUAL_BUILD_TIME=$(echo "$VERSION_RESPONSE" | jq -r '.data.build_time')
        ACTUAL_UPTIME=$(echo "$VERSION_RESPONSE" | jq -r '.data.uptime')
    else
        ACTUAL_VERSION=$(echo "$VERSION_RESPONSE" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
        ACTUAL_COMMIT=$(echo "$VERSION_RESPONSE" | grep -o '"git_commit":"[^"]*"' | cut -d'"' -f4)
        ACTUAL_BRANCH=$(echo "$VERSION_RESPONSE" | grep -o '"git_branch":"[^"]*"' | cut -d'"' -f4)
        ACTUAL_BUILD_TIME=$(echo "$VERSION_RESPONSE" | grep -o '"build_time":"[^"]*"' | cut -d'"' -f4)
        ACTUAL_UPTIME=$(echo "$VERSION_RESPONSE" | grep -o '"uptime":"[^"]*"' | cut -d'"' -f4)
    fi
    
    echo "   Version: $ACTUAL_VERSION"
    echo "   Commit:  $ACTUAL_COMMIT"
    echo "   Branch:  $ACTUAL_BRANCH"
    echo "   Built:   $ACTUAL_BUILD_TIME"
    echo "   Uptime:  $ACTUAL_UPTIME"
else
    echo "   ✗ Version API is not accessible (service may not be running)"
    echo "   Response: $VERSION_RESPONSE"
fi

echo ""

echo "3. Expected output format in deployment scripts:"
echo "=== Current Deployed Version ==="
echo "Version: 1.0.0"
echo "Commit:  3c3853cc619d53a2700b403eb176832dbd9b4c46"
echo "Branch:  main"
echo "Built:   2024-01-15_10:30:45_UTC"
echo "Uptime:  2h 15m 30s"
echo "✓ Successfully deployed version 1.0.0"
echo "=================================="

echo ""
echo "4. Uptime format examples:"
echo "   Short durations: 500ms, 1s 500ms"
echo "   Medium durations: 2m 30s, 15m 45s"
echo "   Long durations: 2h 15m 30s, 1d 3h 20m 15s"
echo "   Precision: milliseconds for short durations, seconds for longer ones"

echo ""
echo "=== Test completed ==="
echo "The version display functionality now includes uptime information."
echo "This provides immediate feedback about what version was just deployed and how long it has been running." 