# Trying Ideation Factory with Docker Compose

Everything on one machine, from our published images, to see it working: not for production, which wants three machines or more (see [Deploying](../README.md)). There's one engine, so a restart of anything is a pause.

```
this machine:  Caddy (TLS) ──> app, directory ──> engine ──> bucket (SeaweedFS here, or your S3)
                                 └──> mail server ──> people's addresses
```

## With everything here (SeaweedFS)

```sh
cd deploy/compose
cp seaweedfs.env.example .env     # fill it in: secrets are `openssl rand -hex 32`
docker compose up -d
```

## With your S3 buckets (AWS)

Make the two buckets first, with public access blocked and versioning on, and a key for each allowed only its own bucket ([what each needs](../README.md#what-every-deployment-needs)).

```sh
cd deploy/compose
cp aws.env.example .env           # fill in the buckets and keys too
docker compose up -d
```

The example settings choose which Compose files make it up (`COMPOSE_FILE`): `compose.yaml`, which both share, with `seaweedfs.yaml` or `aws.yaml` on top.

It's up once `docker compose ps` shows the app and the directory healthy: each one's health check passes only while it's connected to the engine. On a new install that takes a little over a minute, as a new engine waits about a minute before it serves. Sign in at `IDEAF_URL` with an address in `IDEAF_SITE_ADMINS`.

## What runs

- **caddy:** TLS, HTTP→HTTPS, and the proxy to the app, WebSockets included (TLS, below).
- **app:** the server, with the web app built in.
- **directory:** the same server in a process of its own, hosting only the directory (the actor every request touches), so its work has a thread to itself.
- **engine:** our build of the Rivet Engine. Its write-ahead log is on this machine's disk, in the `engine` volume; everything durable goes on to the bucket.
- **pool:** a one-off step that creates the engine's node pools, for the app and the directory.
- **mail:** a mail server (Postfix) that delivers sign-in codes and notifications straight to people's addresses.
- **seaweedfs** and **buckets** (`seaweedfs.yaml` only): an S3 store on this machine, and the two buckets in it.

## Email

The mail server here needs no account anywhere: it hands each email to the recipient's own mail server, from `sign-in@` and `notifications@` the name in `IDEAF_HOST`. But it doesn't have what real senders have (SPF and DKIM records in the domain's DNS), so:

- **it often lands in spam,** or is refused, by Gmail, Outlook and most companies;
- **nothing gets out where outgoing port 25 is blocked,** which is most home connections, and AWS unless you ask for it to be opened.

That's fine for trying it. To reach inboxes reliably, set `IDEAF_SMTP_URL` (and `IDEAF_EMAIL_FROM`, `IDEAF_NOTIFY_FROM`) to a relay you have: Amazon SES, Postmark, Mailgun, Resend, Gmail with an app password, your company's. The mail server then sits idle.

## TLS

`TLS_MODE` picks where the certificate comes from. Caddy gets it and renews it itself.

| `TLS_MODE`      | Certificate                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal`      | Caddy's own local CA, for trying it out (the default). Browsers warn.                                                                          |
| `acme`          | Let's Encrypt (or another public ACME server, `ACME_SERVER`). The name in `IDEAF_HOST` must reach this machine on ports 80 and 443.             |
| `acme-internal` | Your company's ACME server (step-ca, say): `ACME_SERVER` is its directory URL, and its root certificate goes in `ca/`, named in `ACME_CA_FILE`. |
| `files`         | Your own certificate: `tls/fullchain.pem` and `tls/privkey.pem`. Replace them and run `docker compose restart caddy` to renew.                    |

## Changing things

- **A newer build:** `docker compose pull && docker compose up -d`. `IDEAF_VERSION` picks another: a release (`v0.1.<n>`), `master` for the newest commit, or a commit's `sha-<7 characters>`.
- **Keys, or anything the engine's or SeaweedFS's settings are made from:** `docker compose up -d --force-recreate`. Compose doesn't notice a change to those settings and keeps the old ones running.
- **Start again from nothing:** `docker compose down -v` deletes the data, SeaweedFS's included.
