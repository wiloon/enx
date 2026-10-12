#!/usr/bin/env bash
# Run build/build.sh inside the golang image pinned in build/build.conf through
# a local Docker daemon (GitHub Actions, or any machine with Docker), so the
# build uses exactly the Go and ko that homelab Tekton uses (ADR-056).
#
#   enx-api/build/docker-build.sh <registry/repo:tag>
#
# Passed through to build.sh when set: ENX_PUSH, ENX_IMAGE_REF_FILE (a path
# under the repo), GOPROXY, VERSION, GIT_COMMIT, GIT_BRANCH, BUILD_TIME.
# Go caches live on the host at ENX_GO_CACHE_DIR (default ~/.cache/enx-api-go)
# so CI can save and restore them. Registry credentials are read from
# ${DOCKER_CONFIG:-~/.docker}/config.json.
set -euo pipefail

IMAGE=${1:?usage: docker-build.sh <registry/repo:tag>}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
# shellcheck source=build.conf
. "$HERE/build.conf"

CACHE=${ENX_GO_CACHE_DIR:-$HOME/.cache/enx-api-go}
DOCKER_CFG=${DOCKER_CONFIG:-$HOME/.docker}
mkdir -p "$CACHE/build" "$CACHE/mod" "$DOCKER_CFG"

# Run as the calling user: the caches and any ref file stay owned by it.
docker run --rm \
  -u "$(id -u):$(id -g)" \
  -v "$REPO_ROOT":/src \
  -v "$CACHE":/cache \
  -v "$DOCKER_CFG":/docker:ro \
  -w /src \
  -e HOME=/tmp \
  -e DOCKER_CONFIG=/docker \
  -e GOCACHE=/cache/build \
  -e GOMODCACHE=/cache/mod \
  -e ENX_IMAGE="$IMAGE" \
  -e ENX_PUSH="${ENX_PUSH:-1}" \
  -e ENX_IMAGE_REF_FILE="${ENX_IMAGE_REF_FILE:-}" \
  -e GOPROXY="${GOPROXY:-https://proxy.golang.org,direct}" \
  -e VERSION="${VERSION:-dev}" \
  -e GIT_COMMIT="${GIT_COMMIT:-unknown}" \
  -e GIT_BRANCH="${GIT_BRANCH:-unknown}" \
  -e BUILD_TIME="${BUILD_TIME:-}" \
  "$ENX_GO_IMAGE" \
  bash enx-api/build/build.sh
