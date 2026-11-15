#!/bin/sh
# Writes .env for trying Ideation Factory with Docker Compose (README.md): .env.example, with two new
# secrets and the site admin's email, asked for (admin@example.com unless you give one).
#
#   ./create-env.sh                              asks for the email
#   ADMIN_EMAIL=you@example.com ./create-env.sh  doesn't
#
# It won't replace an existing .env: its secrets go with the data already made.
set -eu
cd "$(dirname "$0")"

if [ -e .env ]; then
  echo ".env is already here; it's kept, as its secrets go with the data already made." >&2
  echo "To start again from nothing: docker compose down -v, then rm .env and run this again." >&2
  exit 1
fi

# 32 random bytes, as hex, without needing openssl
secret() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

email=${ADMIN_EMAIL:-}
if [ -z "$email" ] && [ -t 0 ]; then
  echo "The site admin's email, to sign in with. Sign-in codes go to Mailpit"
  echo "(http://localhost:8025), not to anyone's inbox, so any address will do."
  printf 'Admin email [admin@example.com]: '
  read -r email
fi
email=${email:-admin@example.com}
case "$email" in
  *@*.*) ;;
  *)
    echo "\"$email\" isn't an email address" >&2
    exit 1
    ;;
esac

auth=$(secret)
token=$(secret)
umask 077
sed -e "s|^IDEAF_AUTH_SECRET=.*|IDEAF_AUTH_SECRET=$auth|" \
  -e "s|^RIVET_ADMIN_TOKEN=.*|RIVET_ADMIN_TOKEN=$token|" \
  -e "s|^IDEAF_SITE_ADMINS=.*|IDEAF_SITE_ADMINS=$email|" \
  .env.example > .env

echo "Wrote .env, with new secrets, for $email. Next:"
echo "  docker compose up -d"
echo "then open http://localhost:8080 and sign in as $email, with the code from http://localhost:8025"
