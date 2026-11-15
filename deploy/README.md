# Deploying Ideation Factory

Every way of running it uses our builds, which CI publishes for each commit on `master` (and, later, each release): never a build from the source on the machine.

| Where                             | For                                   | Guide                                    |
| --------------------------------- | ------------------------------------- | ---------------------------------------- |
| **VMs or bare metal**             | production: three machines or more    | [vm/](vm/) (being written)               |
| **Docker Compose, on one machine** | trying it                             | [compose/](compose/README.md)            |
| **Kubernetes**                    | later                                 | [kubernetes/](kubernetes/README.md)      |

This follows Rivet's own advice for its engine (rivet.dev/docs/deploy): Compose to try it, VMs or Kubernetes with three or more engines and a bucket for production. The `docker/` folder is something else: a sandbox for trying ideaf with Claude Code, not a deployment.

## Our builds

- **The app:** `ghcr.io/ckedwards/ideation-factory/app`, the server with the web app built in.
- **The engine:** `ghcr.io/ckedwards/ideation-factory/engine`, Rivet's release pinned to the one the app's RivetKit needs, with Rivet's crash reports to them off unless turned on (`RIVET__TELEMETRY__ENABLED=true`). Rivet wants every engine on the same release, upgraded before RivetKit, so the two come together.

Releases are `v0.1.<n>` while in alpha. The images are tagged with each release's version and `latest` (the newest release), `master` (the newest commit on `master`), and `sha-<commit>` (seven characters). Each release also has the native builds that VMs and bare metal install, on its GitHub release page. Every machine of a deployment runs the same version.

## What every deployment needs

**A bucket, or two.** The engine keeps everything durable in one bucket; the app keeps files in another. The engine needs a store with conditional writes: AWS S3, Google Cloud Storage, Azure Blob Storage, Cloudflare R2 or SeaweedFS will do; Garage won't, and MinIO is archived. (The app's files speak only S3 so far, so Azure needs a file store of its own first.) Block public access, and turn versioning on, as Rivet advises for the engine's.

**A key for each bucket.** The engine and the app each get their own key, allowed only their own bucket, so neither can touch the other's data.

- The engine's (`S3_ENGINE_ACCESS_KEY_ID`, `S3_ENGINE_SECRET_ACCESS_KEY`) reads, writes, deletes and lists in its bucket: on AWS, `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` and `s3:AbortMultipartUpload`.
- The app's (`S3_FILES_ACCESS_KEY_ID`, `S3_FILES_SECRET_ACCESS_KEY`) reads and writes files, which never change once stored and aren't deleted, and lists the bucket: `s3:GetObject` and `s3:PutObject` on its objects, and `s3:ListBucket` on the bucket, nothing else. Without the listing, S3 answers a file that isn't there yet with 403, not 404, and the app checks for a file before storing it; it says so if the permission is missing.

**Email** for sign-in codes and notifications: over SMTP to a provider or a company's relay (`IDEAF_SMTP_URL`), or through the machine's own `sendmail` (`IDEAF_EMAIL=sendmail`), when its mail setup already relays its mail. Without either, codes go to the app's log, which production refuses unless `IDEAF_EMAIL=log` says so.

**Internal CAs** for the app's own connections (single sign-on, SMTP, the bucket, MCP clients' metadata documents): their certificates in the app's `ca/` folder (`*.pem` or `*.crt`) are trusted.

**The app's own settings** (single sign-on, SCIM, personal tokens, MCP client hosts) are in the main README.

## Losing a machine, today

Writes that were acknowledged are never lost: every test kept them all. Measured on three machines ([the load test's report](../packages/load/reports/report1/session2/README.md)):

- **An app stopped** (a redeploy, anything that sends SIGTERM, given 60 s before SIGKILL): it hands its actors to the other machines first. No request failed.
- **An app that crashes** (or is killed): its actors wait out the engine's 40 s lost threshold before they start elsewhere. Under load, a minute or two later, they all start again at once, cold, and requests failed for nearly two minutes.
- **The directory's process stopped, even gracefully, or killed:** the directory moves to a standby process, which starts cold, and under load the whole site failed for about 3 to 5 minutes while it caught up. Until that's fixed, restart the directory's process when it's quiet.
- **A whole machine lost** (its engine with it): its actors moved to the others in 100 to 136 s, in 5 of 5 tests on Rivet 3.1.1. On 3.0.6 they got stuck in 2 of 15 until the machine returned (rivet-dev/rivet#5957, still open). To unstick an actor without waiting, send `POST /actors/<actor id>/reschedule?namespace=default`, with the admin token, to a surviving engine on port 6420; its ID is in the surviving engines' logs, on the "actor did not become ready" lines.

## Upgrading

Pull the new tag (or, while it's `latest`, the newest) on every machine, the engine before the app, as Rivet requires. Each new build of the app is a newer node version: the engine moves actors to it once it connects, with a short pause. With several machines, every app must report the same version (`RIVET_NODE_VERSION`, the commit's time unless set): the engine gives new and waking actors only to the highest version it sees, so mixed versions put every actor on whichever machine is newest.
