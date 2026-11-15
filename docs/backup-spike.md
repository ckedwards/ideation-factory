# Spike: backups and restoring

**Status:** planned, needed for 1.0. The design below is a proposal; the experiments decide it. Throwaway code until then; the answer goes into [architecture](architecture.md), the admin guide (`docs/admin/backups.md`) and the [implementation plan](implementation-plan.md).

## The question

How does someone running Ideation Factory **get back to an earlier state**: one idea after its storage is lost or damaged, everything after a disaster, or the whole deployment moved to a new cluster. And can it be done **without stopping the app** and without a database server?

## Why we're asking

Every idea's history, comments and reviews live in its own actor's SQLite database, kept by Rivet's engines. Today there's one way back, and it's coarse:

- **Whole-deployment snapshots work,** but only offline and all at once. They were tested on the Frankfurt load-test deployment (`packages/load/DEPLOYMENT.md`, "The seed: once, then restored"): stop every container, snapshot the nodes' disks, copy both buckets, and restore all of it. The data answered, with no failures. But it means downtime for every backup, it loses everyone's work since the backup, and it only restores onto the same engines at the same addresses.
- **Rivet offers nothing finer.** An actor fork copies the actor's *latest* committed database (`api-public-shim/src/routes.rs`, `fork_actor`), so it copies damage too. There's no point-in-time restore, and Rivet doesn't document a live backup of a cluster.
- **Actors' databases can be damaged.** On the Frankfurt deployment, 20 new ideas were left with databases that never open again ("database disk image is malformed", SQLite code 11; "file is not a database", code 26). Each was being created when an engine restarted, once after it stopped itself (too many open files) and once from a graceful restart. None of those writes had been acknowledged, so nothing was lost that time. But the same thing during an edit to an existing idea would leave it unopenable, and today nothing could bring it back. That's a Rivet bug; backups are what makes it survivable.

## What's already known

| Data | Where it lives | Backing it up |
|---|---|---|
| **An idea:** its versions with their file manifests (`versions`, `version_files`, `steps`), comments and their anchors, reviews, status history, the draft, the outbox and write keys | its actor's SQLite (`server/src/idea/schema.ts`) | nothing today, apart from whole-deployment snapshots |
| **The directory:** people, memberships, grants, numbering, handle and idea aliases, the inbox and its events, subscriptions, watches, notification settings, the email queue, and Better Auth's sign-in tables beside them (`auth/in-directory.ts`) | the directory actor's SQLite (`server/src/directory/schema.ts`); 47 MB at 25,000 ideas (`docs/admin/performance.md`) | the same |
| **Search** | the search actor | none needed: it's derived from the ideas, and can be rebuilt |
| **Files' contents** | the files bucket, by content hash; never changed, never deleted, and the app's key can't delete (`deploy/README.md`) | already safe from the app; versioning would make it safe from an operator's mistake too |
| **Settings and secrets** | each node's `.env` | by hand: a password manager |

And from the code:

- **The directory has each idea's `updated_at`,** indexed (`ideas_updated`), so it could find the ideas that changed. But that time only moves on writes that send notifications (versions, comments, reviews, status: `actors/idea.ts`, `lastActivity`), and reaches the directory a while later. **Draft changes and pending review comments don't move it.**
- **A file's bytes are already in the files bucket before its version commits,** so a version's manifest is the only thing missing to rebuild its files from the bucket alone.
- **Importing at scale costs about what seeding does:** 37 minutes for the design scale (10,000 people, 100,000 ideas) on the Frankfurt deployment.

## The design to test

Four pieces, cheapest first. Each is useful on its own.

### 1. A manifest for each version, written with it

Before a version commits, write `manifests/<idea>/<version>.json` to the files bucket, beside its files: the idea, the version and its parent, author, time, message, and each file's path and content hash. It never changes. With manifests alone, a broken idea can be rebuilt **with every version and every file**, but **without its comments, reviews, status or draft.**

A manifest written for a version whose commit then fails describes a version that never was. A restore should either accept it (the person did submit it) or check against the idea's last export; to decide.

### 2. An export of each idea

Every table's rows, read in one transaction so they're consistent, with the schema version, as one object. **Rows, not the database file:** RivetKit doesn't offer the raw file, and rows can be imported into a newer schema, another cluster or a later Rivet. One candidate format is a SQLite file built from the rows (with `bun:sqlite`), which people can open with any SQLite tool; the other is newline-separated JSON.

Exports are **stored by their hash,** like files, so an unchanged idea makes no new object.

When an idea exports, one of two ways (the spike chooses):

- **A nightly job:** asks the directory for the ideas changed since its last run, and asks each to export. This needs **a marker that every write moves**, drafts and pending reviews included, carried in the index beside `updated_at`.
- **Each idea exports itself once it's quiet,** like email bundling: an alarm some minutes after its last write. No scan, the work is spread through the day, and it loses minutes rather than up to a day. The nightly job then only does the directory.

### 3. The directory, exported whole

The same kind of export, of the whole directory, at least nightly. It holds who everyone is and who may see what, so it matters most and changes most. Search isn't exported: it's rebuilt from the ideas after a restore.

### 4. Restore points

Each night, one small object: every idea's ID with the hash of its latest export, and the directory export's hash. **That object is a complete restore point, by reference.** Keeping 30 nights means keeping 30 of them, plus the exports they refer to; pruning deletes older points, then exports no point refers to.

What a restore loses:

| Kept | A broken idea comes back with | Lost |
|---|---|---|
| Manifests only | every version and its files | **all** comments, reviews, status and the draft |
| Manifests and nightly exports | last night's export, then later versions from manifests | comments, reviews and draft changes since last night |
| Manifests and exports when ideas go quiet | the latest export, then later versions | the last few minutes' comments and draft |

### Where backups go

A **bucket of their own,** with versioning and possibly Object Lock. The app gets a key that can **only write** there (`s3:PutObject`), so a leaked app key can't read or erase backups; restoring uses a separate key that can read, and pruning one that can delete, run by an admin, not the app.

### Restoring

- **One idea:** a new actor for it, its chosen export imported, then any later versions from manifests. Its actor, if damaged, is deleted first (`DELETE /actors/<id>`), so its key is free. Nobody else is touched.
- **Everything, to a night:** the directory's export, then every idea's, then search rebuilt. For a disaster where a whole-deployment snapshot can't be used, or to move to a new cluster.
- **Checking a backup:** restore it to a scratch deployment and open every idea, regularly, as part of the guide.

## What it needs to show

1. A version's manifest can be written before its commit without slowing writes noticeably.
2. An idea can be exported in one consistent read, quickly enough to do for every changed idea, without blocking its writes for long.
3. An export can be imported into a fresh actor and give back the same idea: the same IDs, number, versions, comments and anchors, reviews, status and draft, as the API shows them.
4. The directory can be exported and imported the same way, sign-in included: people can sign in afterwards, and their tokens and grants still work.
5. A restored idea and a directory restored from another moment stay consistent, or the mismatch can be found and repaired (an idea's team, its grants, its inbox rows).
6. The whole thing runs while the app serves its usual load.

## Experiments

On the Frankfurt deployment, with its design-scale seed (`packages/load/DEPLOYMENT.md`):

- **Manifests:** add the write; compare a version write's latency and failures, with and without, under the load test's bots.
- **Exporting one idea:** the time and size for a small idea, a typical seeded one, and one at the size limits (`limits.max_idea_bytes`, up to 4 MB of files, plus many versions and comments). Whether the read holds up the idea's writes, and for how long.
- **Exporting many:** every seeded idea once, then every idea one day of load test changes. The total time, bytes stored, S3 requests, and the CPU on the nodes. Both triggers: the nightly job and exporting once quiet.
- **The directory:** export time and size at the design scale; whether the export holds up sign-ins and lists.
- **Import:** one idea into a fresh actor, compared with the original through the API. Then a broken idea: break one on purpose (a restart during a write, as happened), delete its actor, restore it. Then everything into an empty deployment, and the time it takes.
- **Formats:** SQLite file against newline-separated JSON, for size, time, and how easy each is to read years later.
- **Consistency:** restore an idea from the night before while the directory is current, and list what disagrees.

## Deciding

- **Nightly job or ideas exporting themselves once quiet:** by how much they lose (minutes or a day), the load each puts on the nodes, and how simple each is to run and check.
- **The export format:** whatever imports reliably and is easiest to inspect.
- **What's promised:** how much can be lost (the recovery point) and how long a restore takes (the recovery time), for one idea and for everything. These go in the admin guide.
- **Whether whole-deployment snapshots stay part of the answer:** they're still the fastest way back from losing the whole deployment, if the downtime for taking them is acceptable.

## Risks

- **Export reads compete with writes** for an idea's single SQLite connection, and the directory's: a big export could hold up requests.
- **Restoring two things from different moments** (an idea and the directory) can disagree, about access especially. Restoring access wrongly is worse than not restoring.
- **Backups hold everything,** including sign-in data: their bucket and keys need the same care as the deployment's own.
- **Damage that isn't noticed** gets exported too. An export of an idea whose database won't open fails, which is right; one that opens but is subtly wrong would be kept. Exports should check what they read (`PRAGMA quick_check`) at least sometimes.
- **Rivet's own storage** may change between releases (it did between 3.0 and 3.1), which is one reason to export rows rather than anything of Rivet's.

## Time limit

A week. If exporting can't be made consistent and cheap enough in that time, 1.0 ships with version manifests and nightly whole-deployment snapshots, and exports follow.

## Findings

None yet.
