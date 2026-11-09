# Deploying Ideation Factory

Docker Compose files for running it yourself. `one-vm/` is everything on one machine. Three machines, for fail-over, come next.

The `docker/` folder is something else: a sandbox for trying ideaf with Claude Code, not a deployment.

## One VM

```
VM:  Caddy (TLS) ──> app ──> Rivet Engine ──> bucket (SeaweedFS here, or your cloud's)
```

```sh
cd deploy/one-vm
cp .env.example .env      # fill it in: secrets are `openssl rand -hex 32`
docker compose up -d --build
```

It's up once `docker compose ps` shows the app healthy. On a brand-new install that takes a little over a minute, because a new engine waits about a minute before it serves.

**What runs:**

- **caddy:** TLS, HTTP→HTTPS, and the proxy to the app, WebSockets included. See TLS below.
- **app:** the server, with the web app built in. Files go in the bucket, and actors on the engine.
- **engine:** the Rivet Engine (the version RivetKit is pinned to). Its write-ahead log is on this machine's disk, in the `engine` volume, and everything durable goes on to the bucket.
- **pool:** a one-off setup step. It creates the engine's node pool that the app joins, with old app versions drained on upgrade.
- **seaweedfs** and **buckets** (the `seaweedfs` profile): an S3 store on this machine, and the two buckets in it.

**Your cloud's bucket instead.** Take `seaweedfs` out of `COMPOSE_PROFILES`, then set `S3_ENDPOINT`, `S3_REGION` and the keys. Make the two buckets yourself (`S3_FILES_BUCKET`, `S3_ENGINE_BUCKET`), and set `S3_ALLOW_HTTP=false`. The engine needs a store with conditional writes: AWS S3, Google Cloud Storage, Azure, Cloudflare R2 or SeaweedFS will do; Garage won't, and MinIO is archived.

## TLS

`TLS_MODE` in `.env` picks where the certificate comes from. Caddy gets it and renews it itself, and serves a renewed one with no restart.

| `TLS_MODE` | Certificate |
|---|---|
| `acme` | Let's Encrypt (or another public ACME server, `ACME_SERVER`). The name in `IDEAF_HOST` must reach this machine on ports 80 and 443. |
| `acme-internal` | Your company's ACME server (step-ca, say): set `ACME_SERVER` to its directory URL, and put its root certificate in `ca/`, naming it in `ACME_CA_FILE`. |
| `files` | Your own certificate, from an internal CA or bought: `tls/fullchain.pem` and `tls/privkey.pem`. Replace them and run `docker compose restart caddy` to renew. |
| `internal` | Caddy's own local CA, for trying it out. Browsers warn. |

**Internal CAs for the app's own connections:** put their certificates in `ca/` (`*.pem` or `*.crt`). The app trusts them for single sign-on, SMTP, the bucket and MCP clients' metadata documents.

## Settings

Everything is in `.env.example`. The app's own settings (single sign-on, SCIM, personal tokens, MCP client hosts) are in the main README.

## Upgrading

```sh
git pull
docker compose up -d --build
```

Each build of the app is a new node version, so the engine moves actors over to it once it connects. There's a short pause while that happens.
