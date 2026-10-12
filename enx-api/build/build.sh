#!/usr/bin/env bash
# Build the enx-api image with ko (ADR-056).
#
# The single build entry point for every environment: homelab Tekton
# (w10n-config task-ko-build.yaml) and GitHub Actions (deploy-prod.yml,
# enx-api-ci.yml) both run THIS script inside ENX_GO_IMAGE from
# build/build.conf. Environments differ only in the inputs below.
#
# Required:
#   ENX_IMAGE         image to produce, registry/repo:tag
# Optional:
#   ENX_PUSH=0        build only, push nothing (PR CI)
#   ENX_BASE_IMAGE_MIRROR  host replacing docker.io in the base image reference
#                     (homelab: the in-cluster Nexus Docker Hub proxy)
#   ENX_INSECURE=1    the registries are plain HTTP (homelab Nexus ports)
#   ENX_IMAGE_REF_FILE  where to write the pushed image as repo@digest
#   GOPROXY, GOCACHE, GOMODCACHE  passed through to go / ko as usual
#   VERSION, GIT_COMMIT, GIT_BRANCH, BUILD_TIME  stamped into enx-api/version
#   Registry credentials: $DOCKER_CONFIG/config.json (ko reads it itself).
set -euo pipefail

: "${ENX_IMAGE:?}"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP=$(dirname "$HERE")
# shellcheck source=build.conf
. "$HERE/build.conf"

case $ENX_IMAGE in
  */*:*) ;;
  *) echo "ENX_IMAGE must be registry/repo:tag, got $ENX_IMAGE" >&2; exit 1 ;;
esac
REPO=${ENX_IMAGE%:*}
TAG=${ENX_IMAGE##*:}

BASE=$ENX_BASE_IMAGE
if [ -n "${ENX_BASE_IMAGE_MIRROR:-}" ]; then
  BASE=${BASE/#docker.io/$ENX_BASE_IMAGE_MIRROR}
fi

# Build with the Go in ENX_GO_IMAGE, never a toolchain go.mod asks to download.
export GOTOOLCHAIN=local
export KO_DOCKER_REPO=$REPO
export KO_DEFAULTBASEIMAGE=$BASE
export VERSION=${VERSION:-dev}
export GIT_COMMIT=${GIT_COMMIT:-unknown}
export GIT_BRANCH=${GIT_BRANCH:-unknown}
export BUILD_TIME=${BUILD_TIME:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}

ARGS=(
  --bare
  --tags="$TAG"
  # Image only, no separate SBOM artifact next to it in the registry.
  --sbom=none
)
[ "${ENX_PUSH:-1}" = 0 ] && ARGS+=(--push=false)
[ "${ENX_INSECURE:-}" = 1 ] && ARGS+=(--insecure-registry)

echo "go: $(go version)"
echo "ko: $ENX_KO_VERSION"
echo "base image: $BASE"
echo "image: $ENX_IMAGE (version=$VERSION commit=$GIT_COMMIT branch=$GIT_BRANCH built=$BUILD_TIME)"

cd "$APP"
REF=$(go run "github.com/google/ko@$ENX_KO_VERSION" build "${ARGS[@]}" .)
echo "built: $REF"
[ -n "${ENX_IMAGE_REF_FILE:-}" ] && printf '%s' "$REF" > "$ENX_IMAGE_REF_FILE"
exit 0
