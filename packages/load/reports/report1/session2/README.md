# Session 2: the directory on machines of its own, and fail-over

14 November 2026, 6:56 to 9:23 pm ET, on the same deployment and seed as [session 1](../session1/).

## What ran

- **The three nodes,** as in session 1, all on `app-bench:sha-e6f8638` (RivetKit 3.1.1 with the fix for rivet-dev/rivet#5991), the nodes' code at `b90a29c` (their engines' API published for the directory machines).
- **Two directory machines**, `c8a.xlarge`: AMD EPYC 9R45 at 4.5 GHz, one thread a core, against the nodes' `m7i` at 3.2 GHz and two (the directory is limited by one thread, so it wants fast cores, not more of them). Each runs a directory process only (`deploy/three-vms/directory.yaml` then, now `packages/load/deployment/directory.yaml`), connected to one node's engine: the first to node 1's, the second to node 2's. The nodes then ran without theirs.
- **S3 request metrics split by prefix**: the cluster's coordination (`rivet/cluster/`), each node's storage records (`rivet/depot/cluster/`), and the data (`rivet/depot/tablets/`).

| Time (ET)   | What                                                                                   |
| ----------- | -------------------------------------------------------------------------------------- |
| 6:56        | The machines started; then 10 minutes left alone                                       |
| 7:06 – 7:46 | At rest: 40 minutes, nothing at all touching the deployment                            |
| 7:46 – 7:52 | Each node updated and its engine restarted, one at a time, at rest                     |
| 7:53        | The directory moved to the directory machines (the nodes' directory processes stopped) |
| 7:59        | The steps ([run 1](runs/directory-machines-1/))                                        |
| 8:15        | Again, in tens from 120 ([run 2](runs/directory-machines-2/))                          |
| 8:28        | Back to three nodes, the directory machines stopped                                    |
| 8:33 – 8:54 | Fail-over, under 80 page views a second ([events](failover-events.txt))                |
| 8:59 – 9:21 | `remote.sh check`: all 100,000 ideas opened, none failed                               |
| 9:23        | Stopped                                                                                |

## At rest: the engines' floor

Steady across the 40 minutes, the four 10-minute slices within a few percent of each other ([s3-at-rest.txt](s3-at-rest.txt)), so it isn't aftermath of anything:

| An hour, at rest                                       | GET    | PUT          | LIST  | DELETE |
| ------------------------------------------------------ | ------ | ------------ | ----- | ------ |
| The engine bucket                                      | 81,700 | 4,600        | 1,800 | 2,300  |
| of which the data (`tablets/`)                         | 77,000 | 800 to 1,400 |       |        |
| of which the nodes' storage records (`depot/cluster/`) | 3,500  | 3,600        |       |        |
| of which coordination and keys (`rivet/cluster/`)      | 530    | 0            |       |        |

It read back 129 MB and wrote 90 MB an hour; the files bucket had no requests at all.

- **The leases are as Rivet's source says:** 3,600 PUTs an hour on the nodes' storage records, three engines renewing every 3 s (1,200 each), and the engines' listings about 600 an hour each (every 10 s).
- **Nearly all of it is the data:** about 77,000 GETs an hour, some 7 a second per engine, with nobody using the app. Whether it grows with the engines or with the data, three engines can't tell.
- **What it costs:** at Azure Blob's prices (Hot LRS: $0.05 per 10,000 writes or listings, $0.004 per 10,000 reads), about $16.50 a month in PUTs, $6.50 in LISTs and $23.50 in GETs: **about $45 to $50 a month for three engines idling**, about the same on S3. About 93 GB a month read back, within Azure's 100 GB free over the internet.

## The directory on machines of its own

**Three nodes hold about 140 page views a second comfortably, and 150 at the edge**, against 120 and 130 with the directory on the nodes: about one step, some 15%, more.

| p95                                | 120          | 130    | 140          | 150                | 160                |
| ---------------------------------- | ------------ | ------ | ------------ | ------------------ | ------------------ |
| Run 1                              | 95 ms        | 98 ms  | 224 ms       | 699 ms, 64 dropped | 2.1 s, 488 dropped |
| Run 2                              | 103 ms       | 109 ms | 112 ms       | 1.4 s, 296 dropped |                    |
| Directory on the nodes (session 1) | 94 to 102 ms | 487 ms | 2.9 to 6.3 s |                    |                    |

**The limit is no longer the directory's CPU** ([cpu.tsv](runs/directory-machines-1/cpu.tsv)): at 150 and 160 its process used 56 to 58% of its core; node 1's engine (where its storage seems to be) about 2 cores of 4, the other engines and apps less, the load machine 10%. Nothing was full. The directory keeps its whole database in memory, so its reads are local; but it commits its writes in batches, one batch at a time, each waiting until its storage has it, and from another machine each of those waits crosses the network. RivetKit 3.1.2's deferred commits (writes committed locally and made durable in the background) are aimed at exactly this.

**Moving the directory costs a cold start,** even done gracefully: the new process has none of its database in memory, and reads it back page by page. At 30 page views a second, right after the move: 45% of requests failed in the first 40 s, and the next minute's p95 was 2.7 s; two minutes later it was 84 ms. Moving it back to a node later: a p95 of 960 ms over the first three minutes.

## Fail-over

Under 80 page views a second, two thirds of what three nodes hold, with `remote.sh probe` beside the run: twice a second, a read that needs the directory (`/me`) and a random idea's page, each given 10 s ([events](failover-events.txt)):

| Event (ET)                                          | Requests failing                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| 8:35:02, node 3's app stopped gracefully (SIGTERM)  | none                                                               |
| 8:39:07, the directory's process stopped gracefully | 8:39:07 to 8:43:40: **4 min 34 s**, then 4 s more                  |
| 8:47:02, node 3's app killed (`kill -9`)            | 9 s from 8:48:01; then **1 min 48 s** from 8:49:07                 |
| 8:51:10, the directory's process killed             | 8:51:07 to 8:54:02: **2 min 56 s**, ending as the load was stopped |

- **A graceful stop of an app costs nothing:** its actors are handed over at once.
- **Anything to do with the directory costs minutes under load.** After the graceful stop, requests first went to the process that had stopped (it logged "received request for stale actor generation"), then waited on the new one starting cold.
- **A killed app costs little at first** (most ideas are asleep, and wake on the apps still there), then much more about two minutes later, when the engine gives up on the dead app's actors (its 40 s lost threshold, then its 30 s stop threshold) and starts them all again at once, cold.
- **What keeps it down is the queue, not the deployment.** Requests that arrive during a pause wait, k6 keeps starting 80 page views a second as real people would keep loading pages, and a cold directory or a burst of cold ideas never catches up: when the run was stopped, 893 page views were waiting where 50 to 100 usually are. With the load stopped, everything answered within 20 seconds.

The fourth event landed on a deployment still recovering from the third, so its time is the two together. A fifth, losing a whole node (its engine with it), was left for after the fixes below, as it would mostly measure the same queue again.

**No idea was damaged:** `check` opened all 100,000 afterwards. The run was nearly all reads, so this doesn't rule out the damage the first seed saw, which came from engines restarting while ideas were being written.

## What it means

- **The app should shed load when the directory is slow:** short limits on how long a request waits for the directory, and a quick "try again shortly" (503 with `Retry-After`) past them, so the queue drains rather than grows.
- **The directory should be warm before it takes over:** its new process loading its database before the old one lets go, or at least before it serves.
- **Then fail-over again,** all five events, at 50 and 80 page views a second, against these results.

## Files

- `runs/<run>/steps.tsv`, `meta.txt`, `cpu.tsv`: as in session 1.
- `s3-at-rest.txt`: the 40 minutes at rest, then each 10-minute slice by prefix.
- `s3-directory-machines.txt`: the buckets during the directory machines' first run.
- `failover-events.txt`: each fail-over event, when it happened, and where the directory was.
