#!/bin/bash

# Docker build script for enx-api with version information

set -e

# Get version from git tag or use default
VERSION=${1:-$(git describe --tags --always --dirty 2>/dev/null || echo "dev")}

# Get git commit hash
GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

# Get git branch
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# Get build time
BUILD_TIME=$(date -u '+%Y-%m-%d_%H:%M:%S_UTC')

# Docker image name
IMAGE_NAME="enx-api"
IMAGE_TAG="${VERSION}"

echo "Building Docker image with version information:"
echo "  Version: $VERSION"
echo "  Git Commit: $GIT_COMMIT"
echo "  Git Branch: $GIT_BRANCH"
echo "  Build Time: $BUILD_TIME"
echo "  Image: $IMAGE_NAME:$IMAGE_TAG"

# Build Docker image
docker build \
  --build-arg VERSION="$VERSION" \
  --build-arg GIT_COMMIT="$GIT_COMMIT" \
  --build-arg GIT_BRANCH="$GIT_BRANCH" \
  --build-arg BUILD_TIME="$BUILD_TIME" \
  -f Dockerfile.version \
  -t "$IMAGE_NAME:$IMAGE_TAG" \
  .

echo "Docker build completed successfully!"
echo "You can now run: docker run -p 8080:8080 $IMAGE_NAME:$IMAGE_TAG"

# Optional: tag as latest
if [ "$VERSION" != "dev" ]; then
  echo "Tagging as latest..."
  docker tag "$IMAGE_NAME:$IMAGE_TAG" "$IMAGE_NAME:latest"
fi 