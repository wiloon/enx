#!/bin/bash

# Universal deployment script for enx-api
# Supports both Linux and macOS environments
# Deploys to 192.168.50.36

set -e

# Print Go version
go version

# Detect platform and set source dir
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    SRC_DIR="/Users/wiloon/workspace/projects/enx/enx-api"
    SSH_KEY="~/.ssh/id_ed25519"
    CROSS_COMPILE=true
    OUTPUT_DIR="."
    USE_SCP=true
else
    # Linux
    SRC_DIR="/home/wiloon/workspace/enx/enx-api"
    SSH_KEY="~/.ssh/id_ed25519_w10n"
    CROSS_COMPILE=false
    OUTPUT_DIR="build"
    USE_SCP=false
fi

# Change to source directory
cd "$SRC_DIR" || exit

package_name="enx-api"
mkdir -p "$OUTPUT_DIR"

# Get version information for build
VERSION=${1:-$(git describe --tags --always --dirty 2>/dev/null || echo "dev")}
GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
BUILD_TIME=$(date -u '+%Y-%m-%d_%H:%M:%S_UTC')

echo "Building with version information:"
echo "  Version: $VERSION"
echo "  Git Commit: $GIT_COMMIT"
echo "  Git Branch: $GIT_BRANCH"
echo "  Build Time: $BUILD_TIME"
echo "  Platform: $OSTYPE"
echo "  Cross-compile: $CROSS_COMPILE"

# Set up build environment
if [[ "$CROSS_COMPILE" == "true" ]]; then
    echo "Setting up cross-compilation environment for macOS..."
    export CC=x86_64-unknown-linux-gnu-gcc
    export CXX=x86_64-unknown-linux-gnu-g++
    echo "Using cross-compiler: $CC"
fi

# Build the application
echo "Building enx-api..."
CGO_ENABLED=1 GOOS=linux GOARCH=amd64 go build \
    -ldflags "-X enx-server/version.Version=$VERSION \
               -X enx-server/version.GitCommit=$GIT_COMMIT \
               -X enx-server/version.GitBranch=$GIT_BRANCH \
               -X enx-server/version.BuildTime=$BUILD_TIME" \
    -o ${OUTPUT_DIR}/${package_name} enx-api.go

# Generate checksum file
if [[ "$OUTPUT_DIR" == "build" ]]; then
    echo "Generating sha256 file"
    sha256sum ${OUTPUT_DIR}/${package_name} > ${OUTPUT_DIR}/${package_name}.sha256
else
    echo "Generating md5 file"
    md5sum ${OUTPUT_DIR}/${package_name}
fi

ls -lh ${OUTPUT_DIR}/${package_name}

echo "Stopping service..."

# Deploy to target server
TARGET_IP="192.168.50.36"

# Copy systemd unit file
echo "Copying systemd unit file..."
ansible -i "${TARGET_IP}," all -m copy -a "src=$SRC_DIR/deploy/enx-api.service dest=/etc/systemd/system/enx-api.service" -u root --key-file $SSH_KEY

# Reload systemd
echo "Reloading systemd..."
ansible -i "${TARGET_IP}," all -m shell -a 'systemctl daemon-reload' -u root --key-file $SSH_KEY

# Stop service
echo "Stopping enx-api service..."
ansible -i "${TARGET_IP}," all -m shell -a 'systemctl stop enx-api' -u root --key-file $SSH_KEY

# Copy binary
echo "Copying binary..."
if [[ "$USE_SCP" == "true" ]]; then
    scp -i $SSH_KEY ${OUTPUT_DIR}/${package_name} root@${TARGET_IP}:/usr/local/bin/enx-api
else
    ansible -i "${TARGET_IP}," all -m copy -a "src=$SRC_DIR/${OUTPUT_DIR}/${package_name} dest=/usr/local/bin/enx-api" -u root --key-file $SSH_KEY
fi

# Create necessary directories
echo "Creating directories..."
ansible -i "${TARGET_IP}," all -m file -a 'path=/usr/local/etc/enx/ state=directory mode=0755' -u root --key-file $SSH_KEY
ansible -i "${TARGET_IP}," all -m file -a 'path=/var/lib/enx-api/ state=directory mode=0755' -u root --key-file $SSH_KEY

# Copy configuration file
echo "Copying configuration file..."
if [[ "$USE_SCP" == "true" ]]; then
    scp -i $SSH_KEY config.toml root@${TARGET_IP}:/usr/local/etc/enx/config.toml
else
    ansible -i "${TARGET_IP}," all -m copy -a "src=$SRC_DIR/config.toml dest=/usr/local/etc/enx/config.toml" -u root --key-file $SSH_KEY
fi

# Clean up local build file (macOS only)
if [[ "$CROSS_COMPILE" == "true" ]]; then
    echo "Removing local build binary..."
    rm -f ${OUTPUT_DIR}/${package_name}
fi

echo "Starting service..."

# Enable and start service
ansible -i "${TARGET_IP}," all -m shell -a 'systemctl enable enx-api' -u root --key-file $SSH_KEY
ansible -i "${TARGET_IP}," all -m shell -a 'systemctl restart enx-api' -u root --key-file $SSH_KEY

# Wait for service to start
echo "Waiting for service to start..."
sleep 5

# Test the API
echo "Testing API endpoints..."

# Test ping endpoint
echo "Testing ping endpoint:"
if curl -f http://${TARGET_IP}:8080/ping; then
    echo "✓ Ping endpoint working"
else
    echo "✗ Ping endpoint failed"
fi

# Test version endpoint
echo "Testing version endpoint:"
if curl -f http://${TARGET_IP}:8080/version; then
    echo "✓ Version endpoint working"
else
    echo "✗ Version endpoint failed"
fi

echo ""
echo "Deployment completed successfully!"
echo "You can check the version by calling: curl http://${TARGET_IP}:8080/version"
echo "You can check the service status by calling: ssh root@${TARGET_IP} 'systemctl status enx-api'"

# Get and display current deployed version
echo ""
echo "=== Current Deployed Version ==="
VERSION_RESPONSE=$(curl -s http://${TARGET_IP}:8080/version 2>/dev/null)
if [ $? -eq 0 ]; then
    # Extract version using jq if available, otherwise use grep
    if command -v jq >/dev/null 2>&1; then
        DEPLOYED_VERSION=$(echo "$VERSION_RESPONSE" | jq -r '.data.version')
        DEPLOYED_COMMIT=$(echo "$VERSION_RESPONSE" | jq -r '.data.git_commit')
        DEPLOYED_BRANCH=$(echo "$VERSION_RESPONSE" | jq -r '.data.git_branch')
        DEPLOYED_BUILD_TIME=$(echo "$VERSION_RESPONSE" | jq -r '.data.build_time')
        DEPLOYED_UPTIME=$(echo "$VERSION_RESPONSE" | jq -r '.data.uptime')
    else
        # Fallback to grep if jq is not available
        DEPLOYED_VERSION=$(echo "$VERSION_RESPONSE" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
        DEPLOYED_COMMIT=$(echo "$VERSION_RESPONSE" | grep -o '"git_commit":"[^"]*"' | cut -d'"' -f4)
        DEPLOYED_BRANCH=$(echo "$VERSION_RESPONSE" | grep -o '"git_branch":"[^"]*"' | cut -d'"' -f4)
        DEPLOYED_BUILD_TIME=$(echo "$VERSION_RESPONSE" | grep -o '"build_time":"[^"]*"' | cut -d'"' -f4)
        DEPLOYED_UPTIME=$(echo "$VERSION_RESPONSE" | grep -o '"uptime":"[^"]*"' | cut -d'"' -f4)
    fi
    
    echo "Version: $DEPLOYED_VERSION"
    echo "Commit:  $DEPLOYED_COMMIT"
    echo "Branch:  $DEPLOYED_BRANCH"
    echo "Built:   $DEPLOYED_BUILD_TIME"
    echo "Uptime:  $DEPLOYED_UPTIME"
    echo "✓ Successfully deployed version $DEPLOYED_VERSION"
else
    echo "✗ Failed to retrieve version information"
    echo "Response: $VERSION_RESPONSE"
fi
echo "=================================="
