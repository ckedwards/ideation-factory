#!/bin/bash
# A release's assets, into dist/, with their checksums: the cli for each platform, built from this
# checkout, and the native builds for VMs and bare metal (deploy/vm/install.sh), taken out of the
# release's published images. The release workflow (.github/workflows/release.yml) runs it; it runs
# anywhere with Docker, Bun and the images, to try a release's assets before there's a release.
#
#   scripts/release-assets.sh <version> <images>     like v0.1.1 ghcr.io/ckedwards/ideation-factory
#
#   ideaf-<os>-<arch>.tar.gz              the cli (ideaf), one file with Bun inside: linux and darwin,
#                                         x64 and arm64. For each platform its name is the shortest,
#                                         which is how tools that install from a release by platform
#                                         pick among several matches: mise use -g github:ckedwards/ideation-factory
#   ideaf-server-linux-x64.tar.gz         the app with Bun, and deploy/vm/resources as ideaf/vm
#   rivet-engine-linux-x64.tar.gz         the engine
#   rivetkit-fix-linux-x64.tar.gz         RivetKit's native module with the fix for rivet-dev/rivet#5991,
#                                         for install.sh --rivetkit-fix: only when
#                                         <images>/rivetkit-napi-fixed has one for the RivetKit the app
#                                         pins (the RivetKit fix workflow)
#   SHA256SUMS
set -euo pipefail
VERSION=${1:?the release, like v0.1.1}
IMAGES=${2:?where its images are, like ghcr.io/ckedwards/ideation-factory}
ROOT=$(git rev-parse --show-toplevel)
DIST=$ROOT/dist
cd "$ROOT"

take() {
  local id
  id=$(docker create "$1" /none)
  docker cp -q "$id:$2" "$3"
  docker rm "$id" >/dev/null
}

rm -rf "$DIST"
mkdir -p "$DIST/ideaf/bin" "$DIST/engine"
docker pull -q "$IMAGES/app:$VERSION" >/dev/null
docker pull -q "$IMAGES/engine:$VERSION" >/dev/null
take "$IMAGES/app:$VERSION" /app "$DIST/ideaf/app"
take "$IMAGES/app:$VERSION" /usr/local/bin/bun "$DIST/ideaf/bin/bun"
take "$IMAGES/engine:$VERSION" /usr/bin/rivet-engine "$DIST/engine/rivet-engine"
cp -r deploy/vm/resources "$DIST/ideaf/vm"
echo "$VERSION" > "$DIST/ideaf/VERSION"
tar -C "$DIST" -czf "$DIST/ideaf-server-linux-x64.tar.gz" ideaf
tar -C "$DIST/engine" -czf "$DIST/rivet-engine-linux-x64.tar.gz" rivet-engine
assets=(ideaf-server-linux-x64.tar.gz rivet-engine-linux-x64.tar.gz)

# the cli, for each platform: Bun builds them all from here
for platform in linux-x64 linux-arm64 darwin-x64 darwin-arm64; do
  out="$DIST/cli/$platform"
  mkdir -p "$out"
  bun build --compile --minify --target="bun-$platform" --define "IDEAF_RELEASE=\"$VERSION\"" \
    packages/cli/src/main.ts --outfile "$out/ideaf" >/dev/null
  tar -C "$out" -czf "$DIST/ideaf-$platform.tar.gz" ideaf
  assets+=("ideaf-$platform.tar.gz")
done

# the RivetKit the app pins: the native module install.sh --rivetkit-fix replaces is for it
rivetkit=$(grep -oE '"rivetkit": "[^"]+"' packages/server/package.json | grep -oE '[0-9][^"]*')
module="$IMAGES/rivetkit-napi-fixed:$rivetkit"
if docker pull -q "$module" >/dev/null 2>&1; then
  mkdir -p "$DIST/rivetkit-fix"
  take "$module" /rivetkit-napi.linux-x64-gnu.node "$DIST/rivetkit-fix/rivetkit-napi.linux-x64-gnu.node"
  echo "$rivetkit" > "$DIST/rivetkit-fix/RIVETKIT_VERSION"
  tar -C "$DIST" -czf "$DIST/rivetkit-fix-linux-x64.tar.gz" rivetkit-fix
  assets+=(rivetkit-fix-linux-x64.tar.gz)
else
  echo "::warning::No $module: this release has no --rivetkit-fix (run the RivetKit fix workflow for $rivetkit first)"
fi

(cd "$DIST" && sha256sum "${assets[@]}" > SHA256SUMS)
for asset in "${assets[@]}" SHA256SUMS; do
  printf '%-32s %s\n' "$asset" "$(du -h "$DIST/$asset" | cut -f1)"
done
