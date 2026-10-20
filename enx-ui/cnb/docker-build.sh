#!/usr/bin/env bash
# Run cnb/build.sh inside the pinned builder through a local Docker daemon
# (GitHub Actions, or any machine with Docker) and leave the image in that
# daemon -- so it can be smoke-tested before anything is pushed (ADR-055).
#
#   enx-ui/cnb/docker-build.sh enx-ui:smoke
#
# Passed through to build.sh when set: ENX_CACHE_IMAGE, ENX_NPM_REGISTRY,
# ENX_VERSION, ENX_GIT_COMMIT, ENX_BUILD_TIME.
# Registry credentials for the cache image: CNB_REGISTRY_AUTH
# ({"<registry>": "Basic <base64 user:pass>"}), read by the lifecycle itself.
set -euo pipefail

IMAGE=${1:?usage: docker-build.sh <image>}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP=$(dirname "$HERE")
# shellcheck source=images.conf
. "$HERE/images.conf"

# Daemon mode reads the run image from the daemon.
docker pull -q "$ENX_CNB_RUN_IMAGE" >/dev/null

# Build from a clean copy: no local node_modules/.next, and the container may
# chown it for the CNB user without touching the checkout.
SRC=$(mktemp -d)
trap 'docker run --rm -v "$SRC":/s alpine:3 rm -rf /s/app >/dev/null 2>&1 || true; rm -rf "$SRC"' EXIT
mkdir "$SRC/app"
tar -C "$APP" --exclude=./node_modules --exclude=./.next -cf - . | tar -C "$SRC/app" -xf -

docker run --rm -u root \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$SRC/app":/workspace/app \
  -e ENX_APP_DIR=/workspace/app \
  -e ENX_IMAGE="$IMAGE" \
  -e ENX_DAEMON=1 \
  -e ENX_CACHE_IMAGE="${ENX_CACHE_IMAGE:-}" \
  -e ENX_NPM_REGISTRY="${ENX_NPM_REGISTRY:-}" \
  -e ENX_VERSION="${ENX_VERSION:-}" \
  -e ENX_GIT_COMMIT="${ENX_GIT_COMMIT:-}" \
  -e ENX_BUILD_TIME="${ENX_BUILD_TIME:-}" \
  -e CNB_REGISTRY_AUTH="${CNB_REGISTRY_AUTH:-}" \
  "$ENX_CNB_BUILDER_IMAGE" \
  bash /workspace/app/cnb/build.sh
