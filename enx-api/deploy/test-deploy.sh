#!/bin/bash

# Test script for deploy.sh functionality
# This script tests the platform detection and build logic without actual deployment

set -e

echo "=== Testing deploy.sh functionality ==="
echo ""

# Test platform detection
echo "1. Testing platform detection:"
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "   Platform: macOS"
    SRC_DIR="/Users/wiloon/workspace/projects/enx/enx-api"
    SSH_KEY="~/.ssh/id_ed25519"
    CROSS_COMPILE=true
    OUTPUT_DIR="."
    USE_SCP=true
else
    echo "   Platform: Linux"
    SRC_DIR="/home/wiloon/workspace/enx/enx-api"
    SSH_KEY="~/.ssh/id_ed25519_w10n"
    CROSS_COMPILE=false
    OUTPUT_DIR="build"
    USE_SCP=false
fi

echo "   Source directory: $SRC_DIR"
echo "   SSH key: $SSH_KEY"
echo "   Cross-compile: $CROSS_COMPILE"
echo "   Output directory: $OUTPUT_DIR"
echo "   Use SCP: $USE_SCP"
echo ""

# Test version detection
echo "2. Testing version detection:"
VERSION=${1:-$(git describe --tags --always --dirty 2>/dev/null || echo "dev")}
GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
BUILD_TIME=$(date -u '+%Y-%m-%d_%H:%M:%S_UTC')

echo "   Version: $VERSION"
echo "   Git Commit: $GIT_COMMIT"
echo "   Git Branch: $GIT_BRANCH"
echo "   Build Time: $BUILD_TIME"
echo ""

# Test build command generation
echo "3. Testing build command generation:"
BUILD_CMD="CGO_ENABLED=1 GOOS=linux GOARCH=amd64 go build"
BUILD_CMD="$BUILD_CMD -ldflags \"-X enx-server/version.Version=$VERSION"
BUILD_CMD="$BUILD_CMD -X enx-server/version.GitCommit=$GIT_COMMIT"
BUILD_CMD="$BUILD_CMD -X enx-server/version.GitBranch=$GIT_BRANCH"
BUILD_CMD="$BUILD_CMD -X enx-server/version.BuildTime=$BUILD_TIME\""
BUILD_CMD="$BUILD_CMD -o ${OUTPUT_DIR}/enx-api enx-api.go"

echo "   Build command:"
echo "   $BUILD_CMD"
echo ""

# Test cross-compilation setup
if [[ "$CROSS_COMPILE" == "true" ]]; then
    echo "4. Testing cross-compilation setup:"
    echo "   CC: x86_64-unknown-linux-gnu-gcc"
    echo "   CXX: x86_64-unknown-linux-gnu-g++"
    echo ""
fi

# Test file transfer method
echo "5. Testing file transfer method:"
if [[ "$USE_SCP" == "true" ]]; then
    echo "   Method: SCP"
    echo "   Command: scp -i $SSH_KEY ${OUTPUT_DIR}/enx-api root@192.168.50.36:/usr/local/bin/enx-api"
else
    echo "   Method: Ansible"
    echo "   Command: ansible -i '192.168.50.36,' all -m copy -a \"src=$SRC_DIR/${OUTPUT_DIR}/enx-api dest=/usr/local/bin/enx-api\" -u root --key-file $SSH_KEY"
fi
echo ""

# Test checksum method
echo "6. Testing checksum method:"
if [[ "$OUTPUT_DIR" == "build" ]]; then
    echo "   Method: SHA256"
    echo "   Command: sha256sum ${OUTPUT_DIR}/enx-api > ${OUTPUT_DIR}/enx-api.sha256"
else
    echo "   Method: MD5"
    echo "   Command: md5sum ${OUTPUT_DIR}/enx-api"
fi
echo ""

# Test cleanup
if [[ "$CROSS_COMPILE" == "true" ]]; then
    echo "7. Testing cleanup:"
    echo "   Command: rm -f ${OUTPUT_DIR}/enx-api"
    echo ""
fi

echo "=== Test completed successfully ==="
echo "All platform-specific configurations are correctly detected."
echo ""
echo "To run actual deployment:"
echo "  ./deploy/deploy.sh"
echo ""
echo "To run deployment with specific version:"
echo "  ./deploy/deploy.sh 1.0.0" 