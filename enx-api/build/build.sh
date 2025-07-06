#!/bin/bash

# Build script for enx-api with version information injection

set -e

# Get version from git tag or use default
VERSION=${1:-$(git describe --tags --always --dirty 2>/dev/null || echo "dev")}

# Get git commit hash
GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

# Get git branch
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# Get build time
BUILD_TIME=$(date -u '+%Y-%m-%d_%H:%M:%S_UTC')

echo "Building enx-api with version information:"
echo "  Version: $VERSION"
echo "  Git Commit: $GIT_COMMIT"
echo "  Git Branch: $GIT_BRANCH"
echo "  Build Time: $BUILD_TIME"

# Build the application with version information
go build -ldflags "-X enx-server/version.Version=$VERSION \
                   -X enx-server/version.GitCommit=$GIT_COMMIT \
                   -X enx-server/version.GitBranch=$GIT_BRANCH \
                   -X enx-server/version.BuildTime=$BUILD_TIME" \
         -o enx-api \
         .

echo "Build completed successfully!"
echo "You can now run: ./enx-api" 