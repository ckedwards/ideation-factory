# Ideation Factory on VMs or bare metal

For production: three machines or more, each running a release's native builds under systemd, as Rivet documents its engine (rivet.dev/docs/deploy). No Docker: the install downloads them from the release, and checks them.

```
                     load balancer (TLS, to each app's port 8080)
                    /                  |                   \
machine 1: app, directory,   machine 2: the same      machine 3: the same
           engine
           \_______ private network (engines on 6421, each app to its own engine on 6420) _______/
                                         |
                       two buckets (outside every machine)
```

## What's here

- `install.sh`: installs or upgrades a release on one machine (Installing, below).
- `resources/`: what it installs, from the release: the systemd units, the helpers they run, and the example settings.
- `extras/`: for the machines around them: [caddy](extras/caddy/README.md), a load balancer.

## What it needs

- **Three machines or more,** each on its own hardware, on one private network: x86_64, Ubuntu 22.04, Debian 12, RHEL 9 or later (the engine needs glibc 2.34), with systemd, curl, tar and sha256sum. At least 4 vCPU and 16 GB each; dedicated or non-burstable CPUs (`m7i`, not `t3`), as burstable ones slow down under steady load.
- **A disk on each, of its own,** for the engine's write-ahead log and cache in `/var/lib/rivet`: block storage (local NVMe, or EBS and the like), never a network file system, and at least 100 GiB. The engine keeps a tenth of it, and at least 4 GiB, free, and won't start without.
- **Two buckets,** with public access blocked and versioning on, and a key for each allowed only its own ([what each needs](../README.md#what-every-deployment-needs)).
- **A load balancer** for TLS: your cloud's, or Caddy on a machine of its own ([extras/caddy](extras/caddy/README.md) has its configuration). It sends requests to the apps' port 8080, checks `/health` there, and should allow long-lived connections (live updates are WebSockets): an hour's idle timeout, as Rivet advises.
- **Email:** the machines' own mail setup through `sendmail` (Postfix, msmtp, a company relay), or SMTP to a provider ([email](../README.md#what-every-deployment-needs)).

**The network:** 6421 (the engines to each other) and 6420 (the engine's API) stay private: 6421 is plaintext and unauthenticated, and 6420 needs nothing from outside, as each app talks to its own machine's engine. 8080 is for the load balancer only. 8081 is the directory process's own health check, for the machine itself.

## Installing

On each machine:

```sh
curl -fsSL https://raw.githubusercontent.com/ckedwards/ideation-factory/master/deploy/vm/install.sh | sudo bash -s -- v0.1.3
```

The release is optional (the newest unless given), but every machine should run the same one, so name it. It downloads the release's two builds and `SHA256SUMS` from its GitHub release, refuses them unless they match, and installs:

| What                                 | Where                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| the engine                           | `/usr/local/bin/rivet-engine`, run as the `rivet` user                               |
| the app, and Bun                     | `/opt/ideaf/app` and `/opt/ideaf/bin`, run as the `ideaf` user (the last one kept in `app.previous`) |
| the units, and the helpers they run  | `rivet`, `ideaf-pools`, `ideaf`, `ideaf-directory` in `/etc/systemd/system`; the release's `deploy/vm/resources` in `/opt/ideaf/vm` |
| the engine's settings                | `/etc/rivet/config.json`, readable by `rivet` only (from `rivet.json.example`)       |
| the app's settings                   | `/etc/ideaf/ideaf.env`, readable by root and `ideaf` (from `ideaf.env.example`)      |
| internal CAs, for the app's own connections | `/etc/ideaf/ca/*.pem` or `*.crt`                                               |
| data                                 | `/var/lib/rivet` (the engine's disk) and `/var/lib/ideaf`                            |
| what was installed                   | `/opt/ideaf/VERSION`                                                                  |

## Settings

**`/etc/rivet/config.json`,** the same on every machine but its address: the admin token (`openssl rand -hex 32`), this machine's private address as `advertise_address` (`10.0.0.11:6421`), the engine's bucket and key. Crash reports to Rivet stay off unless you turn `telemetry` on. Every other engine setting is in Rivet's configuration reference; unknown settings are refused.

**`/etc/ideaf/ideaf.env`,** the same on every machine: the public URL, the sign-in secret, the load balancer's addresses (`IDEAF_TRUSTED_PROXIES`), the admin token (twice: on its own, and in `RIVET_ENDPOINT`), the files bucket and key, and email. The app's other settings (single sign-on, SCIM, personal tokens, MCP clients) are in the main README.

## Starting

Start the engines on all machines within a minute of each other (a new cluster waits for three before it makes its storage), then the rest:

```sh
systemctl enable --now rivet ideaf-pools ideaf ideaf-directory
```

- `curl -s localhost:6420/health` is the engine (`"status":"ok"`); `curl -s localhost:8080/health` the app and `localhost:8081/health` the directory process, each 200 once connected to the engine.
- A new engine waits about a minute before it serves, and the app restarts itself until then: give it two.
- Logs: `journalctl -u rivet`, `-u ideaf`, `-u ideaf-directory`.

## Upgrading

Every machine on the same release, the engines before the apps (Rivet's rule: a newer RivetKit may speak a protocol an older engine can't). On each machine, the install again with the new release (`… | sudo bash -s -- v0.1.<n>`), then:

1. **The engines,** on every machine: `systemctl restart rivet`. This release's engine wants a full stop when it changes (stop all, start all); later ones may allow one at a time, when their notes say so.
2. **The apps, one machine at a time,** each healthy before the next: `systemctl restart ideaf-directory ideaf`. On SIGTERM each hands its actors to the other machines; the directory's move is the slow part ([losing a machine](../README.md#losing-a-machine-today)), so do it when it's quiet.

With several machines, every app reports the build's node version, the same on every machine running it; set `RIVET_NODE_VERSION` only to override it, the same everywhere. To go back, install the previous release (or move `/opt/ideaf/app.previous` back) and restart.

## Before going live

Rivet's checklist, for this deployment: three engines, each on its own machine and disk, all on the same release; the buckets with versioning on and their keys allowed only their own; 6421 and 6420 private; the admin token in `/etc/rivet/config.json` only, readable by `rivet`; a tested restore of the data ([backups](../../docs/backup-spike.md), being designed); and an upgrade tried once.
