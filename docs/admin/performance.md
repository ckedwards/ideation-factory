# Performance and sizing

For people running Ideation Factory: which settings matter as a deployment grows, what the warnings in the logs mean, and how much machine it needs. The numbers come from the load test in `packages/load`. Its README has the method and every finding. They were measured on one 22-core machine running the [one-VM Compose](../../deploy/one-vm), on RivetKit 3.0.6 and 3.1.1, each with Rivet's engine image of the same version.

**Status:** first version, from seeding the design scale (10,000 people, 1,000 teams, 2,000 groups, 100,000 ideas). Steady-state and burst numbers, and the engine sizing below, are still being measured.

## Where the time goes

Three parts do the work, and they scale differently:

- **The app nodes** run the API and the actors: one per idea, and one directory that every request touches (people, teams, access, lists, search, inboxes). They need CPU and little memory.
- **The directory** is one actor with one SQLite database, used one statement at a time. Reads are cheap (about 0.2 ms each). A write that commits costs about 3.5 ms, and other requests wait while it runs. It is the deployment's shared ceiling, which is why the app batches its writes: notifications, index updates and new ideas each go in one commit per batch.
- **The Rivet Engine** stores every actor's database: a write-ahead log on local disk, and everything durable in the bucket. As the number of actors grows, its caches matter most (below).

## The app

| Setting | Default | When to change it |
|---|---|---|
| `IDEAF_DIRECTORY_CALLS` | 4 | How many calls each app node sends the directory at once. Keep it at 4 on RivetKit releases without the fix for rivet-dev/rivet#5991 (3.0.6 and 3.1.1 have the bug). There, more calls at once make the directory slower, not faster: at 64 in flight, a write cost 372 ms of CPU instead of 6 ms. Once RivetKit includes the fix, 16 lets reads wait less (10 ms instead of 43 ms during bulk writes). The limit is per app node, so it holds back less with each node added: on three nodes, under steady writes (a bulk import, say), the directory still slowed from about 40 writes a second to 5 within half an hour. Sustained load on the directory needs a RivetKit with the fix. |

The directory keeps its whole database in memory, up to 256 MB, in the process that hosts it. It was 47 MB at 25,000 ideas.

## Several app nodes

Every app node serves requests and hosts actors, and the engine places each actor on a node when it starts. The directory is one actor, so a single node hosts it, and that node does most of the work. With the directory on an app node, at 167 page views a second spread evenly over three nodes, the directory's node used 125–150% CPU and the other two about 45% each. About a fifth of the directory node's JS thread went on serving its share of the API (token checks, routing, calls out to ideas).

**The directory's own nodes.** So the deployment files in `deploy/` run the directory in a process of its own: the same app, started with `RIVET_POOL=directory`, while the app's nodes set `IDEAF_DIRECTORY_POOL=directory` so the directory is made in that pool. The load balancer doesn't send it requests. On one VM that's a second container. On three VMs each VM runs one: the directory runs on one of them, and the other two stand by, at about 100 MB each, ready to take over if that VM is lost. Growing past that is moving the directory's nodes to machines of their own, with nothing to migrate.

An actor's pool is fixed when it's made. A deployment that started without `IDEAF_DIRECTORY_POOL` keeps its directory in the app's pool, and moving it means moving its data, so set it from the start.

**Sizing tiers** (when to add nodes, give the directory machines of its own, or move it to Postgres) are being measured on a real three-VM deployment (`packages/load/README.md`). The first: **three VMs of 4 vCPU hold about 120 page views a second** (400 requests a second; about 7,200 people at a page a minute each, all at once), with a p95 near 100 ms, on RivetKit with the fix for rivet-dev/rivet#5991; on RivetKit as published, a step less, and much less under sustained writes. The limit is the directory's single thread, at a full core, while the rest of the VMs have room: more or bigger VMs don't raise it. The directory on machines of its own, and fail-over, are measured next.

**Restarting a node.** On SIGTERM, an app node stops its actors and tells the engine, so they start again on another node straight away. It waits up to the engine's actor stop threshold (30 s by default) for that. A node that exits without stopping them leaves its actors assigned to it until the engine's `pegboard.node_lost_threshold` passes (40 s by default). That happens when it's killed, when it crashes, or when a supervisor gives up waiting. Until then, requests for those actors wait or fail, and the directory's in-memory database starts cold on its new node. Measured on the three-VM Compose run on one machine: about 45 s in all, whether the crashed node stayed down or Docker restarted it within seconds (a restarted node doesn't take its actors back), and 46 s of the whole site waiting when the directory's node crashed and a standby took over. Stopped with SIGTERM instead, a node handed its actors over in about 0.3 s, with no failed request. In the load test, the few minutes after such exits failed 27% and 61% of requests. Under the same load, once things settled, it was 0–0.2%.

- Give the app's and the directory's containers at least 60 s between SIGTERM and SIGKILL, as Rivet asks: each actor gets up to 15 s to save its state. That's `stop_grace_period: 60s` in Compose (the files in `deploy/` set it; Docker's default is 10 s) and `terminationGracePeriodSeconds: 60` on Kubernetes (its default is 30 s).
- Restart one node at a time, and let each come back healthy before the next. `/health` is RivetKit's own check: it answers 503 while the node's connection to the engine is unhealthy, so the load balancer and Docker don't count on a node cut off from it.
- Keep at least two nodes in each pool, as Rivet advises, so a stopping node's actors have somewhere to go. The three-VM files have three of each. On one VM there's one app node and one directory node, so even a graceful restart leaves their actors unavailable until the node is back: plan restarts and upgrades as a short outage there.
- Don't lower `node_lost_threshold` to shorten the wait. It must stay above the node's longest reconnect backoff (30 s), or an engine restart stops every actor.

## The engine

The engine's defaults suit a few thousand actors. A deployment at the design scale has over 100,000: one per idea, plus the directory. These settings go in the engine's config file (`storage:`), or as `RIVET__STORAGE__…` environment variables:

| Setting | Default | What it does |
|---|---|---|
| `storage.max_background_cold_reads` | 4 | Background reads each storage partition runs at once (replica log reads, forks). When it logs `tablet background cold-read window near its cap`, raising it (32 was tried) clears the warning, though it barely changed how fast new actors were made. |
| `storage.cold_store.block_cache_bytes` | 512 MiB | Data block cache for the whole engine. |
| `storage.cold_store.meta_cache_bytes` | 512 MiB | Index and filter cache for the whole engine. 512 MiB keeps the metadata of about 25 GiB of stored data in memory. |
| `storage.log_shard.max_memory_bytes` | 64 MiB | The write-ahead log's memory. A sixteenth of it holds recent entries for reads; older ones are read from disk. |
| `storage.log_shard.max_disk_bytes` | from free disk | The write-ahead log's local disk. Unset, the engine sizes it from the free space of its filesystem, shared with the cold store's disk cache. |

**What happened at the design scale with the defaults.** Between 48,000 and 87,000 ideas, every write through the engine got 3 to 4 times slower, even writes to a new idea's small actor:

| Measured with nothing else running | 48,000 ideas | 87,000 ideas |
|---|---|---|
| Creating an idea | 51–57 ms | 152–233 ms |
| A comment | 12–17 ms | 47–115 ms |
| An edit | 19–24 ms | 65–220 ms |

Directory reads stayed fast, at about 17 ms. Meanwhile, the engine logged its object cache's evictor queue overflowing (2,781 times in 30 s) and the cold-read window at its cap. Its write-ahead log had grown to 9.8 GB, and it used 3.7 GB of memory. Bigger budgets are the likely remedy; that's being measured next.

## What the warnings mean

| Logged by | Message | Meaning |
|---|---|---|
| App | `sqlite storage is overloaded, retry after … ms` | The engine refused a write for a moment. The app waits and retries. A few during bursts are normal. |
| Engine | `tablet background cold-read window near its cap` | Raise `storage.max_background_cold_reads`. |
| Engine | `evictor queue skipped cache write/access event because it was full` | The engine's caches are too small for what's being read. |
| Engine | `log shard resource near capacity` | The write-ahead log's memory budget is nearly used. |
| Engine | `envoy is gone past its lost threshold; ending the epoch without its stopped report` | An app node went away without stopping its actors, and they're now starting on other nodes. See [Several app nodes](#several-app-nodes). |
| Engine | `tablet maintainer left storage discovery and no live member can take the grant` | On several engines: a lost node's storage hasn't been taken over yet (rivet-dev/rivet#5957). See [deploy/README.md](../../deploy/README.md) for the workaround. |

## Known limits

- **Making many actors at once** tops out at about 80–100 new actors a second on one engine, with some waits of 15 s past 32 at once. That only shows when a bot creates ideas in bulk. Ordinary creation of a few a minute never comes near it.
- **A lost engine node** on a cluster can leave its actors stuck until it returns (rivet-dev/rivet#5957).
- **A lost app node** leaves its actors, possibly the directory, unavailable for the engine's 40 s lost threshold, and slow for a few minutes after (see [Several app nodes](#several-app-nodes)).
