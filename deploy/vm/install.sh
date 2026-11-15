#!/bin/bash
# Installs, or upgrades, Ideation Factory on this machine natively, under systemd (deploy/vm/README.md):
# the engine's binary and the app (with Bun) taken out of our published images, and the units and
# helpers from the app's. Docker or Podman is needed only for that. Settings that are there already
# are left alone; the app it replaces is kept in /opt/ideaf/app.previous.
#
#   sudo ./install.sh [tag]     latest unless given: a commit's sha-<7 characters>, or later a release
#
# To get it, from the image it installs:
#   docker run --rm --entrypoint cat ghcr.io/ckedwards/ideation-factory/app:latest /app/deploy/vm/install.sh > install.sh
set -euo pipefail
TAG=${1:-latest}
REPO=${IDEAF_IMAGES:-ghcr.io/ckedwards/ideation-factory}

die() {
  echo "install.sh: $*" >&2
  exit 1
}
[ "$(id -u)" = 0 ] || die "run it as root (sudo)"
RUN=$(command -v podman || command -v docker || true)
[ -n "$RUN" ] || die "needs Docker or Podman, to take the builds out of their images"
command -v curl >/dev/null || die "needs curl (the node pools' setup uses it)"
command -v systemctl >/dev/null || die "needs systemd"
# the engine's binary needs glibc 2.34 or newer: Ubuntu 22.04, Debian 12, RHEL 9, or later
glibc=$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+$' || true)
if [ -z "$glibc" ] || [ "$(printf '%s\n2.34\n' "$glibc" | sort -V | head -1)" != 2.34 ]; then
  die "needs glibc 2.34 or newer (this machine has ${glibc:-none}): Ubuntu 22.04, Debian 12, RHEL 9, or later"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# copies $2 out of image $1 to $3
take() {
  local id
  id=$("$RUN" create "$1")
  "$RUN" cp "$id:$2" "$3"
  "$RUN" rm "$id" >/dev/null
}

# IDEAF_PULL=0 uses images already on this machine (loaded by hand, say) instead of pulling them
if [ "${IDEAF_PULL:-1}" != 0 ]; then
  echo "pulling $REPO/engine:$TAG and $REPO/app:$TAG"
  "$RUN" pull -q "$REPO/engine:$TAG" >/dev/null
  "$RUN" pull -q "$REPO/app:$TAG" >/dev/null
fi
take "$REPO/engine:$TAG" /usr/bin/rivet-engine "$tmp/rivet-engine"
take "$REPO/app:$TAG" /usr/local/bin/bun "$tmp/bun"
take "$REPO/app:$TAG" /app "$tmp/app"
[ -d "$tmp/app/deploy/vm" ] || die "$REPO/app:$TAG has no deploy/vm: it's older than this guide"

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
install -m 755 "$tmp/bun" /opt/ideaf/bin/bun
rm -rf /opt/ideaf/app.previous
if [ -d /opt/ideaf/app ]; then
  mv /opt/ideaf/app /opt/ideaf/app.previous
fi
mv "$tmp/app" /opt/ideaf/app
chown -R root:root /opt/ideaf/app
chmod -R a+rX /opt/ideaf/app
vm=/opt/ideaf/app/deploy/vm
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
  echo "tag: $TAG"
  echo "engine: $("$RUN" image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' "$REPO/engine:$TAG")"
  echo "app: $("$RUN" image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' "$REPO/app:$TAG")"
  echo "installed: $(date -u +%FT%TZ)"
} > /opt/ideaf/VERSION
systemctl daemon-reload

echo "installed $TAG: /usr/local/bin/rivet-engine, /opt/ideaf (cat /opt/ideaf/VERSION)"
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
