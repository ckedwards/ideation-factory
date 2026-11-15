# VMs, with containers

The same deployment as [the native install](../README.md), with each machine running our published images under Docker Compose in place of the release's native builds. Use whichever your team already runs. Everything else is the same:
- **The machines:** three or more, each with its own disk, a private network and a load balancer.
- **The buckets.**
- **The settings files,** in the same places.
- **The rules for starting and upgrading.**

It needs a release from after `v0.1.0`, the first with `ideaf.yaml`.

```
each machine:  engine ─┬─ app (8080, for the load balancer)        all on the host's network,
                       └─ directory (8081, its health check only)  as the native install
               /etc/rivet/config.json, /etc/ideaf/ideaf.yaml and secrets.yaml, mounted read-only
               /var/lib/rivet (the engine's disk), /var/lib/ideaf
```

## What it needs

What [the native install](../README.md#what-it-needs) needs, with Docker Engine and its Compose plugin in place of systemd running our processes. The images are `ghcr.io/ckedwards/ideation-factory/engine` and `…/app`, at the release's tag (`v0.1.<n>`), the same on every machine.

## Setting up a machine

```sh
v=v0.1.3        # the release every machine runs
raw=https://raw.githubusercontent.com/ckedwards/ideation-factory/$v/deploy/vm
sudo install -d -m 755 /etc/rivet /etc/ideaf /etc/ideaf/ca /opt/ideaf
sudo install -d -m 750 /var/lib/rivet /var/lib/rivet/log /var/lib/ideaf
sudo curl -fsSL -o /etc/rivet/config.json $raw/resources/rivet.json.example
sudo curl -fsSL -o /etc/ideaf/ideaf.yaml $raw/resources/ideaf.yaml.example
sudo curl -fsSL -o /etc/ideaf/secrets.yaml $raw/resources/secrets.yaml.example
sudo chmod 600 /etc/rivet/config.json /etc/ideaf/secrets.yaml
sudo curl -fsSL -o /opt/ideaf/compose.yaml $raw/containers/compose.yaml
echo "IDEAF_VERSION=$v" | sudo tee /opt/ideaf/.env
```

Then fill in the three settings files as for [the native install](../README.md#settings): they're the same files.

## Secrets from your cloud

`secrets.yaml` is one file, so a cloud's secret store can hold all of it as one secret, and the machine writes it out before Compose starts. For example, in the machine's start-up script (cloud-init's user data, say), with the machine's role allowed to read only that secret:

```sh
# AWS Secrets Manager
aws secretsmanager get-secret-value --secret-id ideaf --query SecretString --output text > /etc/ideaf/secrets.yaml
# Google Secret Manager
gcloud secrets versions access latest --secret=ideaf > /etc/ideaf/secrets.yaml
# Azure Key Vault
az keyvault secret show --vault-name <vault> --name ideaf --query value -o tsv > /etc/ideaf/secrets.yaml
```

Run them with `umask 077`, so the file is readable by root only. Compose hands it to the app as a secret, at `/run/secrets/ideaf`. The engine's admin token sits in two places: `/etc/rivet/config.json` (`auth.admin_token`), and `secrets.yaml` as `engine.token`. Write both from the same secret. These commands are sketches: we've tested this file on one machine, not each cloud's secret store.

## Starting

The engines first, on every machine within a minute of each other, as a new cluster waits for three; then the rest:

```sh
cd /opt/ideaf
sudo docker compose up -d engine     # on every machine
sudo docker compose up -d            # then on each
```

It's up when `docker compose ps` shows the app and the directory healthy. Their health checks pass once they're connected to the engine. The app makes the engine's node pools itself.

## Upgrading

The same order as the native install: every machine's engine before any app, then the apps one machine at a time, each healthy before the next. Set the new `IDEAF_VERSION` in `/opt/ideaf/.env` on every machine, then:

```sh
sudo docker compose pull
sudo docker compose up -d engine                 # every machine; Rivet wants them stopped and started together for this release
sudo docker compose up -d app directory          # then one machine at a time
```

## RivetKit's fix, for sustained load

The [native install's `--rivetkit-fix`](../README.md#rivetkits-fix-for-sustained-load) is an image here: set `IDEAF_APP_IMAGE=ghcr.io/ckedwards/ideation-factory/app-bench` in `.env`. It's the same build as the app with RivetKit's native module swapped for the fixed one. It's published for a release when the RivetKit fix workflow has built the module for that release's RivetKit.

## What's set, and why

- **The host's network:** the engine advertises this machine's private address to the others (`api_peer.advertise_address`), and the app reaches it on `127.0.0.1:6420`, as natively. So 6420 and 6421 listen on the machine itself: keep them private with its firewall, as the native install's guide says.
- **The engine's 660 s to stop,** and a million open files, are Rivet's figures. Docker's default of 10 s would kill the engine part-way through stopping.
- **60 s for the app and the directory to stop:** each hands its actors to another machine first.
- **The engine's data on `/var/lib/rivet`,** this machine's own block disk, not a Docker volume on a network file system.

## Tested so far

On one machine, with one engine:
- the engine started, then the app and the directory, from the mounted settings files and the Compose secret, healthy 4 s after the engine;
- the app made both pools, and each process joined its own;
- signed in, created an idea, and read it back after restarting the app.

The load tests ran three machines of nearly this setup (Compose on each, `packages/load/deployment`), but on Docker's own network with ports published. This file's host networking hasn't run on three machines yet.
