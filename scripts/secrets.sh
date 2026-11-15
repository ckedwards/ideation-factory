#!/bin/bash
# Scans for leaked secrets with Betterleaks (github.com/betterleaks/betterleaks), pinned to one release
# and checked against its published checksum before it ever runs. Downloaded once per machine into
# ~/.cache/ideaf/betterleaks/<version>; the rules are Betterleaks' own, with .betterleaks.toml's
# exceptions (test fixtures that only look like secrets).
#
#   scripts/secrets.sh staged     what's staged, before a commit (.githooks/pre-commit)
#   scripts/secrets.sh history    every commit in this branch's history (CI: a pull request's, and master's)
#
# It exits 1 when it finds something: remove it (and, if it was ever pushed, revoke it, as history
# keeps it), or, if it isn't a secret, add an exception to .betterleaks.toml saying why.
set -euo pipefail
VERSION=1.9.0
# betterleaks_<version>_<platform>.tar.gz in checksums.txt of the v1.9.0 release
declare -A SHA256=(
  [linux_x64]=f8b185a39ffcece2a1ca82bf3a4e7435cd81963ffd16b7a9128daf75f35f6de7
  [linux_arm64]=1d39116e0a58dc94574715e2aa12a2dbd5062f193eee3fec011fef6ba06bd13b
  [darwin_x64]=68dfd83458d9e7f90663daa7a81c7f944083b170dae82e4f5f8d0581ed519ef1
  [darwin_arm64]=83dd7eaab13d44a1e8e347a17064cdef153a1478db473276d41b38d55613d3f2
)
ROOT=$(git rev-parse --show-toplevel)
CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/ideaf/betterleaks/$VERSION
BIN=$CACHE/betterleaks

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) echo "secrets.sh: no Betterleaks build for $(uname -s)" >&2; exit 2 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) echo "secrets.sh: no Betterleaks build for $(uname -m)" >&2; exit 2 ;;
esac
platform=${os}_$arch

sha256() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

if [ ! -x "$BIN" ]; then
  archive="betterleaks_${VERSION}_${platform}.tar.gz"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  echo "secrets.sh: downloading Betterleaks $VERSION ($platform), once" >&2
  if ! curl -fsSL --retry 3 -o "$tmp/$archive" \
    "https://github.com/betterleaks/betterleaks/releases/download/v$VERSION/$archive"; then
    echo "secrets.sh: couldn't download Betterleaks; check the connection, then try again" >&2
    exit 2
  fi
  if [ "$(sha256 "$tmp/$archive")" != "${SHA256[$platform]}" ]; then
    echo "secrets.sh: the download doesn't match Betterleaks $VERSION's checksum: not running it" >&2
    exit 2
  fi
  tar -xzf "$tmp/$archive" -C "$tmp" betterleaks
  mkdir -p "$CACHE"
  install -m 755 "$tmp/betterleaks" "$BIN"
fi

cd "$ROOT"
case "${1:-}" in
  staged)
    exec "$BIN" git --pre-commit --staged --redact --no-banner --config .betterleaks.toml
    ;;
  history)
    # this branch only: each branch is checked with its own .betterleaks.toml, so an exception added
    # on one doesn't fail the others until it's merged
    exec "$BIN" git . --redact --no-banner --config .betterleaks.toml --log-opts="HEAD" -v
    ;;
  *)
    sed -n '2,12p' "$0"
    exit 2
    ;;
esac
