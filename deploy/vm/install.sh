#!/bin/bash
# Installs, or upgrades, Ideation Factory on this machine natively, under systemd (deploy/vm/README.md):
# a release's native builds (the app with Bun, and the engine), downloaded from its GitHub release and
# checked against its SHA256SUMS. Needs curl, tar, sha256sum and systemd, nothing else. Settings that
# are there already are left alone; the app it replaces is kept in /opt/ideaf/app.previous.
#
#   curl -fsSL https://raw.githubusercontent.com/ckedwards/ideation-factory/master/deploy/vm/install.sh | sudo bash
#   curl -fsSL .../install.sh | sudo bash -s -- v0.1.3      a release of your choosing; the newest unless given
#   ... | sudo bash -s -- v0.1.3 --rivetkit-fix             with RivetKit's fix for rivet-dev/rivet#5991
#   ... | sudo bash -s -- v0.1.3 --no-rivetkit-fix          back to RivetKit as published
#
# --rivetkit-fix swaps RivetKit's native module for one with the fix for rivet-dev/rivet#5991, which
# isn't in a RivetKit release yet: it matters under sustained load (README.md). It's remembered, so an
# upgrade keeps it until --no-rivetkit-fix. IDEAF_DOWNLOADS is a mirror of the release's assets, to
# install without reaching GitHub.
set -euo pipefail
VERSION=latest
FIX=
for arg in "$@"; do
  case "$arg" in
    --rivetkit-fix) FIX=on ;;
    --no-rivetkit-fix) FIX=off ;;
    *) VERSION=$arg ;;
  esac
done
REPO=${IDEAF_REPO:-ckedwards/ideation-factory}

die() {
  echo "install.sh: $*" >&2
  exit 1
}
[ "$(id -u)" = 0 ] || die "run it as root (sudo)"
for tool in curl tar sha256sum systemctl; do
  command -v "$tool" >/dev/null || die "needs $tool"
done
[ "$(uname -m)" = x86_64 ] || die "the builds are for x86_64 (64-bit Intel or AMD); this machine is $(uname -m)"
# the engine's binary needs glibc 2.34 or newer: Ubuntu 22.04, Debian 12, RHEL 9, or later
glibc=$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+$' || true)
if [ -z "$glibc" ] || [ "$(printf '%s\n2.34\n' "$glibc" | sort -V | head -1)" != 2.34 ]; then
  die "needs glibc 2.34 or newer (this machine has ${glibc:-none}): Ubuntu 22.04, Debian 12, RHEL 9, or later"
fi
if [ "$VERSION" != latest ] && ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  die "a release is like v0.1.3, not $VERSION"
fi
if [ -n "${IDEAF_DOWNLOADS:-}" ]; then
  base=${IDEAF_DOWNLOADS%/}
elif [ "$VERSION" = latest ]; then
  base="https://github.com/$REPO/releases/latest/download"
else
  base="https://github.com/$REPO/releases/download/$VERSION"
fi
# the fix, unless said: as the last install had it
if [ -z "$FIX" ]; then
  FIX=off
  if grep -q '^rivetkit: fixed' /opt/ideaf/VERSION 2>/dev/null; then
    FIX=on
  fi
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "downloading $VERSION from $base"
assets=(ideaf-server-linux-x64.tar.gz rivet-engine-linux-x64.tar.gz)
if [ "$FIX" = on ]; then
  assets+=(rivetkit-fix-linux-x64.tar.gz)
fi
curl -fsSL --retry 3 -o "$tmp/SHA256SUMS" "$base/SHA256SUMS" || die "couldn't download $base/SHA256SUMS"
for asset in "${assets[@]}"; do
  if ! grep -q " $asset\$" "$tmp/SHA256SUMS"; then
    if [ "$asset" = rivetkit-fix-linux-x64.tar.gz ]; then
      die "$VERSION has no RivetKit fix to install: nothing changed. Install it with --no-rivetkit-fix, or another release"
    fi
    die "$VERSION's SHA256SUMS doesn't list $asset"
  fi
  curl -fsSL --retry 3 -o "$tmp/$asset" "$base/$asset" || die "couldn't download $base/$asset"
done
(cd "$tmp" && sha256sum --quiet --ignore-missing -c SHA256SUMS) || die "the downloads don't match their checksums: not installing them"
for asset in "${assets[@]}"; do
  tar -xzf "$tmp/$asset" -C "$tmp"
done
release=$(cat "$tmp/ideaf/VERSION")
if [ "$FIX" = on ]; then
  rivetkit=$(cat "$tmp/rivetkit-fix/RIVETKIT_VERSION")
  module="node_modules/.bun/@rivetkit+rivetkit-napi-linux-x64-gnu@$rivetkit/node_modules/@rivetkit/rivetkit-napi-linux-x64-gnu/rivetkit-napi.linux-x64-gnu.node"
  [ -f "$tmp/ideaf/app/$module" ] || die "the fix is for RivetKit $rivetkit, which $release doesn't have: nothing changed"
  install -m 644 "$tmp/rivetkit-fix/rivetkit-napi.linux-x64-gnu.node" "$tmp/ideaf/app/$module"
fi

# the users the engine and the app run as, their data, and their settings' folders
for user in rivet ideaf; do
  if ! id "$user" >/dev/null 2>&1; then
    useradd --system --home-dir "/var/lib/$user" --shell /usr/sbin/nologin "$user"
  fi
done
install -d -o rivet -g rivet -m 750 /var/lib/rivet /var/lib/rivet/log
install -d -o ideaf -g ideaf -m 750 /var/lib/ideaf
install -d -m 755 /etc/rivet /etc/ideaf /etc/ideaf/ca /opt/ideaf /opt/ideaf/bin

install -m 755 "$tmp/rivet-engine" /usr/local/bin/rivet-engine
install -m 755 "$tmp/ideaf/bin/bun" /opt/ideaf/bin/bun
rm -rf /opt/ideaf/app.previous /opt/ideaf/vm
if [ -d /opt/ideaf/app ]; then
  mv /opt/ideaf/app /opt/ideaf/app.previous
fi
mv "$tmp/ideaf/app" /opt/ideaf/app
mv "$tmp/ideaf/vm" /opt/ideaf/vm
chown -R root:root /opt/ideaf/app /opt/ideaf/vm
chmod -R a+rX /opt/ideaf/app /opt/ideaf/vm
vm=/opt/ideaf/vm
# the release's helpers, units and example settings, whatever it has
install -m 755 "$vm"/ideaf-* /opt/ideaf/bin/
install -m 644 "$vm"/systemd/*.service /etc/systemd/system/

# each example the release has becomes its settings file, unless that's there already
new=0
settings() {
  local example=$1 file=$2 owner=$3 group=$4 mode=$5
  if [ -f "$vm/$example" ] && [ ! -f "$file" ]; then
    install -o "$owner" -g "$group" -m "$mode" "$vm/$example" "$file"
    new=1
  fi
}
settings rivet.json.example /etc/rivet/config.json rivet rivet 600
settings ideaf.yaml.example /etc/ideaf/ideaf.yaml root ideaf 640
settings secrets.yaml.example /etc/ideaf/secrets.yaml root ideaf 640
{
  echo "release: $release"
  if [ "$FIX" = on ]; then
    echo "rivetkit: fixed, $rivetkit with the fix for rivet-dev/rivet#5991 (--no-rivetkit-fix for as published)"
  else
    echo "rivetkit: as published"
  fi
  sed 's/^/sha256: /' "$tmp/SHA256SUMS"
  echo "installed: $(date -u +%FT%TZ)"
} > /opt/ideaf/VERSION
systemctl daemon-reload

fixed=
if [ "$FIX" = on ]; then
  fixed=", with RivetKit's fix for rivet-dev/rivet#5991"
fi
echo "installed $release$fixed: /usr/local/bin/rivet-engine, /opt/ideaf (cat /opt/ideaf/VERSION)"
if [ "$new" = 1 ]; then
  cat <<'EOF'
Next: fill in /etc/rivet/config.json, /etc/ideaf/ideaf.yaml and /etc/ideaf/secrets.yaml
(deploy/vm/README.md), then
  systemctl enable --now rivet ideaf ideaf-directory
EOF
else
  cat <<'EOF'
To run it: the engines first, on every machine, then the apps, one machine at a time (deploy/vm/README.md):
  systemctl restart rivet
  systemctl restart ideaf-directory ideaf
EOF
fi
