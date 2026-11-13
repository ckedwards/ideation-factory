#!/bin/bash
# RivetKit's native module (rivetkit-napi) at the version the app pins, with the fix for
# rivet-dev/rivet#5991 (rivet-dev/rivet#5992): one sleep re-arm task per actor instead of one per
# request. For load tests only (run.sh with LOAD_RIVETKIT_FIX=1), until a release has the fix.
# Needs git and the Rust toolchain (rustup installs the version Rivet pins). Built like the module
# that was measured: release, with symbols and line tables kept, so it can be profiled too.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DATA=$HERE/../.data
VERSION=$(grep -oE '"rivetkit": "[^"]+"' "$HERE/../../server/package.json" | grep -oE '[0-9][^"]*')
SRC=$DATA/rivet-v$VERSION
mkdir -p "$DATA"
if [ ! -d "$SRC" ]; then
  git clone -q --depth 1 --branch "v$VERSION" https://github.com/rivet-dev/rivet.git "$SRC"
fi
cd "$SRC"
if git apply --check "$HERE/rearm-one-waiter.patch" 2>/dev/null; then
  git apply "$HERE/rearm-one-waiter.patch"
fi
RUSTFLAGS="--cfg tokio_unstable" CARGO_PROFILE_RELEASE_DEBUG=line-tables-only CARGO_PROFILE_RELEASE_STRIP=none \
  cargo build -p rivetkit-napi --release --target x86_64-unknown-linux-gnu
cp target/x86_64-unknown-linux-gnu/release/librivetkit_napi.so "$DATA/rivetkit-napi-fixed.node"
echo "built $DATA/rivetkit-napi-fixed.node (rivetkit-napi $VERSION with the fix)"
