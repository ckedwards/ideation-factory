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
exec "$@"
