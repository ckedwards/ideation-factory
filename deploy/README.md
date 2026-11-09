# Deploying Ideation Factory

Docker Compose files for running it yourself: `one-vm/` is everything on one machine; `three-vms/` spreads it over three, behind a load balancer.

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

## Three VMs

```
                 load balancer: lb.yaml (Caddy), or your cloud's
                 /                |                \
VM 1: app + engine      VM 2: app + engine      VM 3: app + engine
             \________ private network (engines on 6421) ________/
                                  |
                       bucket (outside every VM)
```

```sh
cd deploy/three-vms
cp .env.example .env      # the same on every machine, except NODE_ADDRESS
docker compose -f node.yaml up -d --build     # on each of the three VMs
docker compose -f lb.yaml up -d               # on the load balancer
```

- **Each VM** runs the app and an engine (`node.yaml`). The engines find each other through the shared bucket and talk on port 6421. That port and the app's port 8080 must stay on the private network.
- **The load balancer** (`lb.yaml`) is Caddy with the same TLS modes as one VM. It sends requests round-robin to the apps that pass their health check. A cloud load balancer works as well: give it TLS, the three apps' port 8080, and a `/health` check. Any app can serve any request.
- **The bucket** must be outside the VMs: your cloud's, or a SeaweedFS you run separately. One SeaweedFS on one of the three would take the cluster down with it.
- **Trying it on one machine:** `try-locally.yaml` runs all of it on one Docker host, with one SeaweedFS. It's for testing fail-over and load, not for production. It needs a `local.env` with `IDEAF_AUTH_SECRET`, `RIVET_ADMIN_TOKEN` and `S3_SECRET_ACCESS_KEY`.

**What surviving a lost VM means today.** Writes that were acknowledged are never lost: every test kept them all.

- **If a VM's app fails** (a crash or a redeploy), its actors move to the other VMs in seconds.
- **If a whole VM fails** (its engine with it), its actors move to the other VMs in about two minutes: on Rivet 3.0.6's own image, they did in 13 of our 15 tests. In the other two they got stuck until the VM returned: Rivet is tracking this as rivet-dev/rivet#5957. If it held the directory actor, that means the whole site. To unstick an actor without waiting, send `POST /actors/<actor id>/reschedule?namespace=default`, with the admin token, to a surviving engine on port 6420. The actor's ID is in the surviving engines' logs, on the "actor did not become ready" lines.

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
