# Spike: Rivet as the platform

**Status:** planned. Desk research done (below); the experiments are next. Throwaway code; the answer goes into [backend](architecture-backend.md). Runs alongside the [Better Auth spike](spike-better-auth.md), on the same platform.

## The question

Can Ideation Factory run on [Rivet](https://github.com/rivet-dev/rivet) actors, self-hosted, with **an S3-compatible bucket as the only durable storage**: no Postgres, no Cloudflare, nothing a company doesn't already have?

## Why we're asking

Not depending on Cloudflare is a primary goal: the companies we're aiming at mostly don't use it. We also don't want a database server to run. Rivet gives us the same model the design was built around (an actor per idea, each with its own SQLite, plus one directory actor), but on our own containers, persisted to a bucket. See the [overview](architecture.md) and [backend](architecture-backend.md).

## What the research already answered

| Question | Answer | Source |
|---|---|---|
| **Bucket only, no database server?** | **Only on Rivet 3.0, which is in preview.** 3.0's storage engine (WarpDrive) keeps actor data in an S3 bucket (S3, GCS, Azure, R2, or a self-hosted S3-compatible store), so the engine is one stateless binary plus a bucket. Rivet 2.x needs Postgres or FoundationDB, plus NATS, for more than one node; on one node it can use a local file-system store (no bucket) | 3.0 announcement; engine config on `v3.0.0-preview.3` (`object_storage`: `s3` with a custom `endpoint`) and `v2.3.31` (database: `postgres` or `file_system`) |
| **Is 3.0 ready?** | Preview since 2026-10-26, no stable date. It's in preview because multi-region, serverless and ACLs haven't landed; we need none of them. Same RivetKit SDK and protocol as 2.x, "no code changes"; 2.x stays supported, and a zero-downtime migration tool is promised | 3.0 announcement |
| **FTS5 in actor SQLite** | Available. The preview crashed on closing FTS5 connections (issue #5921), fixed in `v3.0.0-preview.3` (PR #5924, released 2026-10-28). The trigram tokenizer still needs one query to confirm | GitHub |
| **Are writes to one actor in order?** | **Not by default.** Actions run in parallel. Rivet recommends **queues for mutations** and actions for reads. SQLite transactions themselves queue in FIFO order | Rivet docs: actions, SQLite |
| **Durability, several instances** | A write is acknowledged once a majority of engine instances have it on disk, then moved to the bucket in the background. Losing one of three instances loses nothing | 3.0 announcement; self-host storage docs |
| **Durability, one instance** | Acknowledged after the local disk only. Data moves to the bucket about **1 minute** after the first unflushed write (plus up to 10% jitter), or sooner once 64 MiB is waiting. So a lost disk could lose roughly the last minute of writes | 3.0 engine config, `depot.write_to_cold_after_ms` and `write_to_cold_above_bytes` (defaults; not yet tested) |
| **Fail-over time** | A node is declared lost **40 s** after its connection drops; its actors restart elsewhere, each start taking up to 15 s. Requests wait up to 45 s for an actor to start | Rivet docs: limits |
| **Size of one actor's database** | No per-database cap found in 3.0 for native runtimes (the 10 GiB `max_storage_bytes` is a 2.x setting; the 256 MiB cap only applies to WebAssembly or remote SQL, which we don't use). One transaction can change at most **128 MiB** | Engine config on both tags; Rivet docs: limits |
| **Busy actor limits** | At most **128 operations** wait behind an active transaction (more fail with `sqlite.transaction_queue_full`); queues hold 1,000 messages of up to 64 KiB by default | Rivet docs: limits |
| **Cold start** | Rivet claims 6.9 ms to start an actor, and 689 ms (median) to wake a 47 MiB database from the bucket | 3.0 announcement (their numbers) |
| **Upgrades** | Nodes carry a version number. New actors go to the newest version, and old actors are stopped and rescheduled onto it, so app deploys don't need downtime with more than one node | Rivet docs: versions |
| **Which buckets work?** | The engine relies on **conditional writes** (`If-Match` / `If-None-Match` on PUT) for leases, heartbeats and manifests, so the store must enforce them. The major clouds do. Self-hosted: **SeaweedFS** (Apache-2.0, mature) and **RustFS** (Apache-2.0, 1.0 since 2026-10) implement them. **Garage doesn't** (issue #1052, open; its replication model can't offer them), and it accepts the headers and overwrites anyway, which would be unsafe. **MinIO's open-source repository is archived** (2026), so it's out | Engine `object-store-util/conditional_write.rs` and `object_storage.rs` at `v3.0.0-preview.3`; SeaweedFS `s3api_object_handlers_put.go`; RustFS s3-tests list; Garage issues #1052, #1326 |
| **Local development** | No bucket needed for the engine: 3.0 has a `file_system` object store for a single engine process, and RivetKit's dev mode keeps actor data on the machine | Engine `object_storage.rs`; Rivet quickstart |
| **Disks** | Block storage of at least 100 GiB per engine instance; no NFS | Self-host storage docs |
| **Release pace** | 8–18 releases a month; Apache-2.0; about 6.4k stars | GitHub |

### What that changes

- **Target Rivet 3.0 (preview).** It's the only version that matches "bucket only". The SDK is the same as 2.x, so our code doesn't depend on which engine runs it. **Fallback:** if 3.0 isn't stable when the MVP ships, a single-VM deployment can run 2.x with its file-system store (no bucket for actor data, so backups are disk snapshots). Multi-node on 2.x would need Postgres, which we're avoiding.
- **Idea actor writes go through a queue.** Comments, edit batches, accepted suggestions, reviews and status changes are queue messages that the actor handles one at a time. Reads stay as parallel actions. The same goes for the directory actor's writes. This is what "in order, no locks" needs to mean in code.
- **The single-VM loss window is about a minute**, by default settings. State it in the self-hosting docs, and test it.

## What it needs to show

1. **Runs as designed:** an idea actor and a directory actor on Bun, with a 3.0 engine persisting to a self-hosted S3-compatible store, on one VM and on three.
2. **Ordering and durability hold:** concurrent writes to one idea are applied in order with nothing lost, and the loss and fail-over behavior matches the numbers above.
3. **The directory actor has headroom:** it sustains our design load (see [scale concerns](scale-concerns.md)) with room to spare.

## Setup

In `experiments/spike-rivet/`:

- **Rivet Engine `v3.0.0-preview.3` or later**, as a container, with `object_storage` pointed at **SeaweedFS** (S3 API, custom endpoint). Repeat the durability tests on **RustFS**, and once on a cloud bucket (S3 or R2) as the reference.
- **A Bun app with RivetKit:** an `idea` actor (versions, comments, an edit-batch handler), a `directory` actor (index rows, inbox, FTS5 search), and a few HTTP routes in front.
- **Two shapes:** one VM (one engine, one app node) and three VMs or three local machines (three engines, three app nodes, nginx round-robin in front).
- **Seed data:** about 100,000 index rows and 10,000 people, generated.

## Experiments

Each has a pass condition. Record results in Findings, below.

### Basics

- [ ] **Bun and RivetKit start against the 3.0 engine.** **Pass:** actors start and answer; no Node-only blockers.
- [ ] **FTS5 with the trigram tokenizer** in the directory actor: create the table, insert, search for a match inside a word, close and reopen the actor. **Pass:** results are right and nothing crashes.
- [ ] **Migrations:** schema created in `onMigrate`, then changed in a second version. **Pass:** the migration applies when the actor wakes on the new code.

### Ordering

- [ ] **Concurrent writes to one idea through a queue:** 50 clients each send 20 comments and 5 edit batches to the same idea at once. **Pass:** every write is applied once, versions are numbered without gaps, and no edit batch is applied against a stale base.
- [ ] **The same test with plain actions** (no queue), to see what goes wrong. **Pass:** we know whether parallel actions need guarding, and the code uses queues where they do.
- [ ] **Reads during writes:** reads keep answering while the queue drains. **Pass:** read latency at the 99th percentile stays under 100 ms.
- [ ] **A write that fails midway:** a queue message is removed when the actor receives it, not when it completes, and isn't redelivered if handling fails (the sender times out). Crash the actor mid-write. **Pass:** the write is either fully applied or not at all, and retrying it from the client is safe (writes carry an idempotency key).

### The bucket

- [ ] **Conditional writes are enforced,** on each store: a PUT with `If-None-Match: *` on an existing key, and with a stale `If-Match` ETag, must both be refused (412). **Pass:** both refused on SeaweedFS and RustFS. A store that accepts them is ruled out.

### Durability and fail-over

- [ ] **Three instances, kill the node hosting the directory actor** mid-load. **Pass:** no acknowledged write is lost; shared requests recover within about a minute (40 s to detect, plus the restart); record the actual gap.
- [ ] **Three instances, wipe one engine's disk** and bring it back. **Pass:** nothing lost; the replacement catches up; record how long.
- [ ] **One instance, restart the VM** (disk kept). **Pass:** nothing lost.
- [ ] **One instance, lose the disk:** write steadily, delete the engine's disk, start a fresh engine on the same bucket. **Pass:** the data comes back from the bucket, and the writes lost are at most about the last minute (the `write_to_cold_after_ms` default). Record the real number for the self-hosting docs.
- [ ] **Bucket outage:** stop the bucket store for 5 minutes under load. **Pass:** writes keep being acknowledged (on disk), and everything reaches the bucket once it's back.

### The directory actor

- [ ] **Steady load:** list, search and inbox reads at the design scale, with index updates and inbox writes from idea actors. **Pass:** reads under 50 ms at the 99th percentile, with the actor busy less than half the time.
- [ ] **Bot burst:** 10 bots each comment on 12 ideas as fast as allowed. **Pass:** no `sqlite.transaction_queue_full` or queue-full errors with coalescing on, and reads stay within target.
- [ ] **Hops:** compare a directory call from the node hosting it with one from another node. **Pass:** the extra time is recorded and small (a few milliseconds).

### Heavy work on one node

[Scale concerns](scale-concerns.md) concern 4: one Bun process hosts many actors on one JavaScript thread, so CPU work in one idea actor delays the rest of the node. Measure **event-loop delay** with a timer probe on each app node: a 10 ms interval that records how late each tick fires.

- [ ] **Large idea, on the main thread:** an idea with 40 files and 500 comments, uploaded and edited repeatedly (re-anchoring, or a stand-in diff of the same size if `core` isn't ready), while other ideas on the same node take ordinary reads. **Pass:** event-loop delay and the other ideas' read latency are recorded, as the baseline.
- [ ] **The same, with the work in Bun worker threads.** **Pass:** event-loop delay under 20 ms at the 99th percentile, and the other ideas' reads stay under 100 ms at the 99th percentile.
- [ ] **During the bot burst** (above), on every app node. **Pass:** event-loop delay is recorded and stays under 20 ms at the 99th percentile.

If worker threads don't meet the target, the next step is moving that heavy work into a Rust actor (the Rust SDK is in beta; Rust and TypeScript actors can call each other in one app), not rewriting the app.

### Waking and upgrades

- [ ] **Cold wake:** an idea actor asleep long enough to be loaded from the bucket. **Pass:** first response under 1 s for a typical idea.
- [ ] **Live updates across sleep:** a viewer's WebSocket closes when the actor sleeps and reconnects on the next change. **Pass:** the web app reconnects without a visible gap.
- [ ] **Rolling deploy:** deploy a new app version to three nodes, one at a time. **Pass:** no failed requests beyond retries.

## What to measure

| Measure | Target |
|---|---|
| Writes lost when one of three instances fails | 0 |
| Writes lost when a single instance's disk is lost | Recorded (expected about 1 minute's worth) |
| Time shared requests wait when the directory's node fails | Recorded (expected about 40–60 s) |
| Directory read latency, 99th percentile, at design load | Under 50 ms |
| Idea-actor cold wake from the bucket | Under 1 s |
| App-node event-loop delay, 99th percentile, large idea with worker threads and during the bot burst | Under 20 ms |
| Engine CPU, memory and disk per instance at design load | Recorded, for the self-hosting sizing guide |

## Deciding

- **Go:** it runs on Bun with a 3.0 engine and at least one self-hosted store (SeaweedFS or RustFS), ordering holds through queues, nothing is lost with three instances, and the directory actor meets its targets.
- **Go, on one VM first:** if 3.0 isn't ready, ship the first installs as one VM on 2.x's file-system store, and move to 3.0 with Rivet's migration tool.
- **No-go:** acknowledged writes are lost with three instances, the directory actor can't meet its targets even with coalescing and the split in [scale concerns](scale-concerns.md) concern 8, or 3.0 stalls with no path off 2.x that avoids Postgres. Then we revisit the platform.

## Risks

- **3.0 is a preview.** The storage engine is new; failure modes will turn up in production use, possibly ours. Rivet keeps 2.x supported meanwhile.
- **Fast-moving project.** Several releases a week means following upgrades closely and pinning versions.
- **A smaller project than a database.** About 6.4k stars and one company behind it. Apache-2.0 means we could fork the engine, but we wouldn't want to.
- **Fail-over isn't instant.** Up to about a minute when the directory actor's node fails. Acceptable for this product, but it should be stated.
- **Self-hosted S3 stores are a thin field.** With MinIO archived and Garage lacking conditional writes, on-premises installs depend on SeaweedFS or RustFS; most companies will use their cloud's storage instead.
- **The single-VM loss window** is about a minute by default and depends on settings; it must be measured and documented, not assumed.

## Time limit

**One week.** Stop early on a clear no-go (lost acknowledged writes with three instances, or the 3.0 engine won't run against any self-hosted store).

## Findings

_To be filled in during the spike._

**Early, from step 0 of the build (2026-10-31):** Bun 1.4.3 runs RivetKit 2.3.31's native runtime with no Node-only blockers. RivetKit starts a local 2.x engine itself, ready in about 0.6–2 s, and a queued write that waits for its result takes about 180 ms on a new actor. Writes through a queue were applied in order, and 25 concurrent writes were each applied once. Still to check on the 3.0 engine.

## Sources

- [Introducing Rivet 3.0 Preview](https://rivet.dev/changelog/2026-10-26-introducing-rivet-3-0-preview/)
- [Self-hosting: control plane](https://rivet.dev/docs/deploy/self-host/control-plane/) and [storage](https://rivet.dev/docs/deploy/self-host/control-plane/storage/)
- Rivet docs: actions, SQLite, limits, versions (in the `rivet-dev/rivet` repo's website docs)
- Engine config: `engine/packages/config/src/config/depot.rs` and `object_storage.rs` at `v3.0.0-preview.3`; `db/mod.rs` and `sqlite.rs` at `v2.3.31`
- [Issue #5921](https://github.com/rivet-dev/rivet/issues/5921) and [PR #5924](https://github.com/rivet-dev/rivet/pull/5924) (FTS5)
