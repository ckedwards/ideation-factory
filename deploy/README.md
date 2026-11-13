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

It's up once `docker compose ps` shows the app and the directory healthy: each one's health check passes only while it's connected to the engine. On a brand-new install that takes a little over a minute, because a new engine waits about a minute before it serves.

**What runs:**

- **caddy:** TLS, HTTP→HTTPS, and the proxy to the app, WebSockets included. See TLS below.
- **app:** the server, with the web app built in. Files go in the bucket, and actors on the engine.
- **directory:** the same server in a process of its own, hosting only the directory (the actor every request touches), so its work has a thread to itself. Nothing but the engine sends it requests. See [Several app nodes](../docs/admin/performance.md#several-app-nodes) for why.
- **engine:** the Rivet Engine (the version RivetKit is pinned to). Its write-ahead log is on this machine's disk, in the `engine` volume, and everything durable goes on to the bucket.
- **pool:** a one-off setup step. It creates the engine's node pools that the app and the directory join, with old app versions drained on upgrade.
- **seaweedfs** and **buckets** (the `seaweedfs` profile): an S3 store on this machine, and the two buckets in it.

**Your cloud's bucket instead.** Take `seaweedfs` out of `COMPOSE_PROFILES`, then set `S3_ENDPOINT`, `S3_REGION` and the keys. Make the two buckets yourself (`S3_FILES_BUCKET`, `S3_ENGINE_BUCKET`), and set `S3_ALLOW_HTTP=false`. The engine needs a store with conditional writes: AWS S3, Google Cloud Storage, Azure, Cloudflare R2 or SeaweedFS will do; Garage won't, and MinIO is archived.

**A key for each bucket.** The engine and the app each get their own key, allowed only their own bucket, so neither can touch the other's data. The engine's key (`S3_ENGINE_ACCESS_KEY_ID`, `S3_ENGINE_SECRET_ACCESS_KEY`) needs to read, write, delete and list in the engine's bucket: on AWS, `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` and `s3:AbortMultipartUpload` on it. The app's (`S3_FILES_ACCESS_KEY_ID`, `S3_FILES_SECRET_ACCESS_KEY`) only reads and writes files, which never change once stored and aren't deleted: `s3:GetObject` and `s3:PutObject` on the files bucket, and nothing else. The SeaweedFS here is set up that way, though its write permission includes deleting. After changing a key, or anything else the engine's or SeaweedFS's settings are made from, run `docker compose up -d --force-recreate`: Compose doesn't notice a change to those settings, and keeps the old ones running.

## Three VMs

```
                 load balancer: lb.yaml (Caddy), or your cloud's
                 /                |                \
VM 1: app, directory,   VM 2: app, directory,   VM 3: app, directory,
      engine                  engine                  engine
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

- **Each VM** runs the app, a directory node and an engine (`node.yaml`). The directory runs on one VM's directory node; the other two stand by, using about 100 MB each, and take over if that VM is lost. The engines find each other through the shared bucket and talk on port 6421. That port and the app's port 8080 must stay on the private network.
- **The load balancer** (`lb.yaml`) is Caddy with the same TLS modes as one VM. It sends requests round-robin to the apps that pass their health check. A cloud load balancer works as well: give it TLS, the three apps' port 8080, and a `/health` check. Any app can serve any request.
- **The bucket** must be outside the VMs: your cloud's, or a SeaweedFS you run separately. One SeaweedFS on one of the three would take the cluster down with it.
- **Trying it on one machine:** `try-locally.yaml` runs all of it on one Docker host, with one SeaweedFS. It's for testing fail-over and load, not for production. It needs a `local.env` with `IDEAF_AUTH_SECRET`, `RIVET_ADMIN_TOKEN`, `S3_ENGINE_SECRET_ACCESS_KEY` and `S3_FILES_SECRET_ACCESS_KEY`.

**What surviving a lost VM means today.** Writes that were acknowledged are never lost: every test kept them all.

- **If a VM's app is stopped** (a redeploy, `docker stop`, anything that sends SIGTERM), it hands its actors to the other VMs before it exits. In our tests no request failed, and none took over a second.
- **If a VM's app crashes** (or is killed), its actors are unavailable for about 45 s, even when Docker restarts it straight away: the engine waits out its 40 s lost threshold before it starts them elsewhere. If that was the directory's node, the whole site waits, then a standby directory node takes over. See [Several app nodes](../docs/admin/performance.md#several-app-nodes).
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
