# Session 1: the three-node tier, and the buckets at rest

14 November 2026, 4:48 to 6:47 pm ET, on the Frankfurt deployment ([DEPLOYMENT.md](../../../DEPLOYMENT.md)).

## What ran

- **Three nodes**, `m7i.xlarge` (4 vCPU, 16 GB): each an app, a directory process and an engine; a `c7i.large` load balancer; a `c7i.xlarge` load machine. S3 in the same region (eu-central-1).
- **The app at `e6f8638`** from the published images: `app-bench`, RivetKit 3.1.1 with the fix for rivet-dev/rivet#5991, and `app`, RivetKit as published. The engine 3.1.1. Each run's `meta.txt` says what every node ran.
- **The design-scale seed:** 10,000 people, 1,000 teams, 2,000 groups, 100,000 ideas, 10,000 comments.
- **The load:** `remote.sh steps`: 5 minutes at 30 page views a second, then 90 s at each rate, stopping after the first step with more than 1% failed or a p95 over a second. A page view is about 3.3 requests, from the web app's own loaders.

| Time (ET)   | What                                                          |
| ----------- | ------------------------------------------------------------- |
| 4:48        | The machines started; S3 request metrics on                   |
| 4:50 – 5:14 | `remote.sh check`: all 100,000 ideas opened, none failed      |
| 5:14 – 5:45 | At rest: nothing running against the deployment               |
| 5:53        | The steps on `app-bench` ([run 1](runs/app-bench-1/))         |
| 6:10        | Again, in tens around the knee ([run 2](runs/app-bench-2/))   |
| 6:26        | The steps on `app`, as published ([run](runs/app-published/)) |
| 6:47        | Stopped                                                       |

A first try at the steps, at 5:45, stopped after one rate: a bug in `remote.sh` put each step's summary in the wrong folder (fixed in #58).

## Results

**Three nodes hold about 120 page views a second comfortably, and 130 at the edge**: about 400 to 430 requests a second, nothing failed. At the design scale's page a minute each, that's about 7,200 people all active at once.

| p95       | 40    | 80    | 100   | 110    | 120    | 130                                | 140                  |
| --------- | ----- | ----- | ----- | ------ | ------ | ---------------------------------- | -------------------- |
| Run 1     | 77 ms | 81 ms | 85 ms |        | 94 ms  |                                    | 2.9 s, 371 dropped   |
| Run 2     |       |       | 86 ms | 96 ms  | 102 ms | 487 ms                             | 6.3 s, 1,093 dropped |
| Published | 81 ms | 85 ms | 93 ms | 123 ms | 272 ms | 6.7 s, 0.09% failed, 2,577 dropped |                      |

**The limit is the directory's single thread** ([cpu.tsv](runs/app-bench-1/cpu.tsv)): its process at 100% of a core at 120 and 111% at 140, while each engine used 1 to 1.4 cores of 4, each app half of one, and the load machine 8%. The page views k6 dropped past the knee were VUs waiting on slow answers, not k6 short of CPU.

**RivetKit as published holds a step less** (120, at a p95 of 272 ms). Its directory used about a tenth more CPU for the same work (103 to 112% at 100 to 120, against 92 to 101%). Short steps of mostly reads understate the bug: seeding on it, sustained writes slowed the directory from about 40 writes a second to 5 within half an hour.

**Reading a file from S3** took p50 about 26 ms and p95 50 to 57 ms, the same on all three nodes and at every rate (the app's `file store` lines, once a minute). A page reads a version's files at once, beside the directory's access check, so it waits for about one read: about a quarter of opening an idea at the median (98 ms at 120 page views a second) and a third at the 95th percentile (160 ms).

**The buckets** ([at rest](s3-at-rest.txt), [under load](s3-under-load.txt), S3's request metrics, three engines):

| An hour                 | At rest (5:15 – 5:45) | Under load (5:54 – 6:40, the three runs) |
| ----------------------- | --------------------- | ---------------------------------------- |
| Engine bucket: GET      | 85,000                | 170,000                                  |
| PUT                     | 4,900                 | 34,400                                   |
| LIST                    | 1,800                 | 1,850                                    |
| DELETE                  | 19,000 (in bursts)    | 28,700                                   |
| Read back / written     | 73 MB / 17 MB         | 2.9 GB / 3.0 GB                          |
| Files bucket: GET, read | none                  | 108,000, 173 MB                          |

LISTs barely change with load: the engines list the bucket on a timer. The at-rest window came straight after `check` had woken every idea, so it may have been high; [session 2](../session2/) measured it again, cleanly.

## Files

- `runs/<run>/steps.tsv`: each step's requests, failed, p95, opening an idea's p95, and page views k6 dropped.
- `runs/<run>/meta.txt`: the settings, the load machine's commit, and each node's image and version.
- `runs/<run>/cpu.tsv`: each container's average CPU at each step (2% or more).
- `s3-at-rest.txt`, `s3-under-load.txt`: the buckets' requests and bytes, by kind.
