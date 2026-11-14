#!/bin/sh
# Trust a company's internal certificate authorities for the app's own
# connections (single sign-on, SMTP, the bucket, MCP clients' documents): any
# *.pem or *.crt mounted in /etc/ideaf/ca is added to the system's roots.
set -e
: > /tmp/ideaf-extra-ca.pem
for certificate in /etc/ideaf/ca/*.pem /etc/ideaf/ca/*.crt; do
  if [ -f "$certificate" ]; then
    cat "$certificate" >> /tmp/ideaf-extra-ca.pem
  fi
done
if [ -s /tmp/ideaf-extra-ca.pem ]; then
  export NODE_EXTRA_CA_CERTS=/tmp/ideaf-extra-ca.pem
fi
# Each build is a newer node version, so the engine moves actors off the older
# app once this one connects (the pool drains on upgrade). With several app
# nodes, set RIVET_NODE_VERSION, the same on each: a build's time differs from
# node to node, and the engine gives actors only to the highest version.
if [ -z "$RIVET_NODE_VERSION" ] && [ -s /app/build-version ]; then
  export RIVET_NODE_VERSION="$(cat /app/build-version)"
fi
exec "$@"
