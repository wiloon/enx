#!/usr/bin/env bash
# Build the enx-ui image with Cloud Native Buildpacks (ADR-055).
#
# The single build entry point for every environment: homelab Tekton
# (w10n-config task-cnb-build.yaml) and GitHub Actions (deploy-prod.yml,
# enx-ui-ci.yml) both run THIS script inside ENX_CNB_BUILDER_IMAGE from
# cnb/images.conf. Environments differ only in the ENX_* inputs below.
#
# Required:
#   ENX_APP_DIR       enx-ui source dir, writable by the CNB user (uid 1000)
#   ENX_IMAGE         image to produce, e.g. registry/enx-ui:<tag>
# Optional:
#   ENX_CACHE_IMAGE   registry image holding the build cache (none: no cache)
#   ENX_NPM_REGISTRY  npm/pnpm registry for this build (none: committed .npmrc)
#   ENX_RUN_IMAGE_MIRROR  host replacing docker.io in the run image reference
#                     (homelab: the in-cluster Nexus Docker Hub proxy)
#   ENX_INSECURE_REGISTRIES  space-separated plain-HTTP registries
#   ENX_PREVIOUS_IMAGE  image to reuse unchanged launch layers from; also
#                     tagged onto the result (registry mode only)
#   ENX_DAEMON=1      write the image to the local Docker daemon instead of a
#                     registry (needs /var/run/docker.sock; run as root)
#   ENX_REPORT        where to copy the lifecycle report.toml
#   ENX_VERSION, ENX_GIT_COMMIT, ENX_BUILD_TIME  this build's tag, commit and
#                     time (default: now), baked into the image's launch env
#                     and shown in the app sidebar (#51)
#   ENX_WORK_DIR      scratch dir for layers/platform (default: /tmp/enx-cnb)
set -euo pipefail

: "${ENX_APP_DIR:?}" "${ENX_IMAGE:?}"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=images.conf
. "$HERE/images.conf"

WORK=${ENX_WORK_DIR:-/tmp/enx-cnb}
LAYERS=$WORK/layers
PLATFORM=$WORK/platform
BUILDPACKS=$WORK/buildpacks
mkdir -p "$LAYERS" "$PLATFORM/env" "$BUILDPACKS"
# Run as root (docker-build.sh, for the daemon socket), the lifecycle drops to
# the CNB user for the build phase, which writes into the app and work dirs.
if [ "$(id -u)" = 0 ]; then
  chown -R "${CNB_USER_ID:-1000}:${CNB_GROUP_ID:-1000}" "$WORK" "$ENX_APP_DIR"
fi

# project.toml [[io.buildpacks.build.env]] -> platform env files (what `pack`
# does; the bare lifecycle does not). Handles the one-line name/value form.
awk -v dir="$PLATFORM/env" '
  /^\[\[io\.buildpacks\.build\.env\]\]/ { inenv = 1; name = ""; next }
  /^\[/ { inenv = 0; next }
  inenv && /^name[ \t]*=/ { match($0, /"[^"]*"/); name = substr($0, RSTART + 1, RLENGTH - 2); next }
  inenv && /^value[ \t]*=/ && name != "" {
    match($0, /"[^"]*"/); v = substr($0, RSTART + 1, RLENGTH - 2)
    f = dir "/" name; printf "%s", v > f; close(f)
    print "build env from project.toml: " name
    name = ""
  }
' "$ENX_APP_DIR/project.toml"
if [ -n "${ENX_NPM_REGISTRY:-}" ]; then
  printf '%s' "$ENX_NPM_REGISTRY" > "$PLATFORM/env/npm_config_registry"
  printf '%s' "$ENX_NPM_REGISTRY" > "$PLATFORM/env/pnpm_config_registry"
  echo "build env: npm/pnpm registry = $ENX_NPM_REGISTRY"
fi

# The build's own version: the buildpack copies these into the image's launch
# env. Per image, not per deployment, so one image still runs anywhere.
ENX_BUILD_TIME=${ENX_BUILD_TIME:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}
for name in ENX_VERSION ENX_GIT_COMMIT ENX_BUILD_TIME; do
  if [ -n "${!name:-}" ]; then
    printf '%s' "${!name}" > "$PLATFORM/env/$name"
    echo "build env: $name = ${!name}"
  fi
done

# The repo's buildpack, laid out as the lifecycle expects
# (<dir>/<id with / -> _>/<version>/), as the only group in the order.
BP_SRC=$HERE/nextjs-standalone
BP_ID=$(sed -n 's/^id = "\(.*\)"/\1/p' "$BP_SRC/buildpack.toml" | head -1)
BP_VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' "$BP_SRC/buildpack.toml" | head -1)
BP_DIR=$BUILDPACKS/${BP_ID//\//_}/$BP_VERSION
mkdir -p "$BP_DIR"
cp -r "$BP_SRC"/. "$BP_DIR"/
chmod +x "$BP_DIR"/bin/*
printf '[[order]]\n\n  [[order.group]]\n    id = "%s"\n    version = "%s"\n' \
  "$BP_ID" "$BP_VERSION" > "$WORK/order.toml"

RUN_IMAGE=$ENX_CNB_RUN_IMAGE
if [ -n "${ENX_RUN_IMAGE_MIRROR:-}" ]; then
  RUN_IMAGE=${RUN_IMAGE/#docker.io/$ENX_RUN_IMAGE_MIRROR}
fi

ARGS=(
  -app="$ENX_APP_DIR"
  -layers="$LAYERS"
  -platform="$PLATFORM"
  -buildpacks="$BUILDPACKS"
  -order="$WORK/order.toml"
  -run-image="$RUN_IMAGE"
  -report="$WORK/report.toml"
)
[ -n "${ENX_CACHE_IMAGE:-}" ] && ARGS+=(-cache-image="$ENX_CACHE_IMAGE")
for r in ${ENX_INSECURE_REGISTRIES:-}; do ARGS+=(-insecure-registry="$r"); done
if [ "${ENX_DAEMON:-}" = 1 ]; then
  ARGS+=(-daemon)
elif [ -n "${ENX_PREVIOUS_IMAGE:-}" ]; then
  ARGS+=(-previous-image="$ENX_PREVIOUS_IMAGE" -tag="$ENX_PREVIOUS_IMAGE")
fi

echo "builder: $ENX_CNB_BUILDER_IMAGE"
echo "run image: $RUN_IMAGE"
echo "buildpack: $BP_ID@$BP_VERSION"
# 0.13+ is needed for -insecure-registry.
CNB_PLATFORM_API=0.14 /cnb/lifecycle/creator "${ARGS[@]}" "$ENX_IMAGE"

echo "--- report.toml"
cat "$WORK/report.toml"
[ -n "${ENX_REPORT:-}" ] && cp "$WORK/report.toml" "$ENX_REPORT"
exit 0
