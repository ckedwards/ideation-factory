#!/bin/bash
# Installs, or upgrades, Ideation Factory on this machine natively, under systemd (deploy/vm/README.md):
# a release's native builds (the app with Bun, and the engine), downloaded from its GitHub release and
# checked against its SHA256SUMS. Needs curl, tar, sha256sum and systemd, nothing else. Settings that
# are there already are left alone; the app it replaces is kept in /opt/ideaf/app.previous.
#
#   curl -fsSL https://raw.githubusercontent.com/ckedwards/ideation-factory/master/deploy/vm/install.sh | sudo bash
#   curl -fsSL .../install.sh | sudo bash -s -- v0.1.3      a release of your choosing; the newest unless given
set -euo pipefail
VERSION=${1:-latest}
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
if [ "$VERSION" = latest ]; then
  base="https://github.com/$REPO/releases/latest/download"
else
  [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "a release is like v0.1.3, not $VERSION"
  base="https://github.com/$REPO/releases/download/$VERSION"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "downloading $VERSION from github.com/$REPO"
for asset in SHA256SUMS ideaf-linux-x64.tar.gz rivet-engine-linux-x64.tar.gz; do
  curl -fsSL --retry 3 -o "$tmp/$asset" "$base/$asset" || die "couldn't download $base/$asset"
done
(cd "$tmp" && sha256sum --quiet -c SHA256SUMS) || die "the downloads don't match their checksums: not installing them"
tar -xzf "$tmp/ideaf-linux-x64.tar.gz" -C "$tmp"
tar -xzf "$tmp/rivet-engine-linux-x64.tar.gz" -C "$tmp"
release=$(cat "$tmp/ideaf/VERSION")

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
install -m 755 "$vm/ideaf-start" "$vm/ideaf-pools" /opt/ideaf/bin/
install -m 644 "$vm"/systemd/*.service /etc/systemd/system/

new=0
if [ ! -f /etc/rivet/config.json ]; then
  install -o rivet -g rivet -m 600 "$vm/rivet.json.example" /etc/rivet/config.json
  new=1
fi
if [ ! -f /etc/ideaf/ideaf.env ]; then
  install -o root -g ideaf -m 640 "$vm/ideaf.env.example" /etc/ideaf/ideaf.env
  new=1
fi
{
  echo "release: $release"
  sed 's/^/sha256: /' "$tmp/SHA256SUMS"
  echo "installed: $(date -u +%FT%TZ)"
} > /opt/ideaf/VERSION
systemctl daemon-reload

echo "installed $release: /usr/local/bin/rivet-engine, /opt/ideaf (cat /opt/ideaf/VERSION)"
if [ "$new" = 1 ]; then
  cat <<'EOF'
Next: fill in /etc/rivet/config.json and /etc/ideaf/ideaf.env (deploy/vm/README.md), then
  systemctl enable --now rivet ideaf-pools ideaf ideaf-directory
EOF
else
  cat <<'EOF'
To run it: the engines first, on every machine, then the apps, one machine at a time (deploy/vm/README.md):
  systemctl restart rivet
  systemctl restart ideaf-directory ideaf
EOF
fi
