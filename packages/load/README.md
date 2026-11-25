# Load test

k6 against this checkout's builds on one machine, set up as production is (`compose.yaml`: TLS, the directory in a process of its own, and buckets, in SeaweedFS here), at the design scale in [scale concerns](../../docs/mvp/scale-concerns.md#load-test-plan): 10,000 people, 1,000 teams, 2,000 groups and 100,000 ideas.

```sh
packages/load/run.sh up       # compose.yaml, with Mailpit, as project ideaf-load
packages/load/run.sh seed     # the data, through the API (resumable: run it again to carry on)
packages/load/run.sh steady   # the steady state
packages/load/run.sh burst    # the steady state with bots
packages/load/run.sh down     # stop, keeping the data; `wipe` deletes it and the seed too
```

`up` writes `.data/load.env` the first time, with new secrets. The site is at https://localhost:18443 (Caddy's local CA), Mailpit at http://localhost:18025. The seeder reaches the app directly at http://localhost:18080.

**Against a deployment** (the three-node Compose in [deployment/](deployment/) on AWS: in Frankfurt for everyday benchmarks, in the US to check production), from a machine of its own: `remote.sh`, with the same commands, plus `steps` (a warm-up, then page views rising in steps until it can't keep up) and `check` (opens every seeded idea, to find any that won't). [DEPLOYMENT.md](DEPLOYMENT.md) says what to make, how to set it up, how to keep the seed, and what it costs. Benchmarks are better made that way: one laptop's CPU throttles on battery and when hot, and a day of runs on one drifted more than the changes they measured.

## What it does

**Seeding** (`src/seed.ts`) signs each person up the way people do: it asks for a code, reads the email from Mailpit and signs in. It then gets each person a personal token. After that, the people make teams and groups, add members, and create ideas, share some with groups and comment on some. Who's in which team, and which ideas each team has, is worked out from indexes in `src/model.ts`, so the k6 script doesn't need tables to find them:

|        |                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------- |
| People | `p0` … `p9999`, each in three teams                                                                                 |
| Teams  | `t0` … `t999`, each made by its first admin, who also makes its ideas                                               |
| Groups | `g0` … `g1999`, ten people each                                                                                     |
| Ideas  | 100 per team, a 2 KB Markdown file each; one in ten shared with a group, and another one in ten with three comments |

What's been made is kept in `.data/seed.json`: IDs, and each person's session cookie and personal token. At full scale, seeding takes about … (see the results).

**Rate limits stay on.** Every request carries its person's own address in `X-Forwarded-For` (`10.x.y.z`). The app trusts that header because the request comes from the Docker network, which the Compose files list in `trusted_proxies`. So the limits count people apart, as they would count real people behind Caddy.

**The k6 script** (`k6/load.ts`) runs two scenarios:

- **Page views** at `LOAD_RATE` a second (167 by default: 10,000 people viewing a page a minute). Each view is one of the seeded people loading a page the way the web app does:
  - home: their ideas and the inbox badge (20%)
  - the Ideas list (15%)
  - a team's page (10%)
  - a search for a word ideas are written in (10%)
  - the inbox (15%)
  - an idea's page: its summary, files, comments and reviews (25%)
  - a comment (3%)
  - marking something read (2%)
- **Bots** (`LOAD_BOTS`, 50 in `burst`), each working for a team's admin. A bot comments and edits on 12 of its team's ideas as fast as it's answered, one edit for every three comments.

**Signing in.** By default, people sign in as the web app does: their session is swapped for a 15-minute JWT, renewed before it runs out. Each VU serves its own slice of the people, so tokens renew at about the real rate, roughly 11 a second for 10,000 people. With `LOAD_AUTH=token`, they use their personal tokens instead, which the directory checks on every request.

## Results

Each run writes its results to `.data/results/`:

- `<name>-<time>.txt`: k6's summary, with every operation's time under `op_<name>` (p50, p95, p99)
- `<name>-<time>.json`: the same summary, as JSON
- `<name>-<time>-stats.csv`: each container's CPU and memory, every 5 s
- `<name>-<time>-warnings.txt`: how often the app and engine logged that storage refused writes, that queue reads or index updates failed, and the like

A stale version (409) counts as `op_stale`, not as a failure: it's what a write gets when someone else made a version first. The run fails if more than 1% of calls fail.

## Findings

From seeding, on one machine (22 cores), RivetKit 3.0.6 and `rivetdev/engine:3.0.6`:

- **A RivetKit bug makes concurrent calls to one actor collapse** (rivet-dev/rivet#5991; fix proposed in rivet-dev/rivet#5992). After every request, RivetKit starts a task that waits for the actor's requests to reach zero. Under steady load they never do, so these tasks pile up, and every idle notification wakes all of them. One directory write (`set_team_watch`) from outside:

  | In flight          | Writes a second | CPU per write |
  | ------------------ | --------------- | ------------- |
  | 4                  | 270             | 6 ms          |
  | 16                 | 125             | 89 ms         |
  | 64                 | 92              | 151 ms        |
  | 64, held for 150 s | 38              | 372 ms        |

  It compounds while load lasts, and leaves a hangover until it drains. `perf` put three quarters of the app's CPU in the kernel's futex spin lock, under tokio's `Notify`.
  - **Workaround, in production until a release has the fix:** each app node sends the directory at most 4 calls at once (`server/src/actors/limit.ts`, `directory.calls`). The same writes then ran at about 220 a second on 1.5 cores, at 16, 64, and 64 held for 90 s.
  - **On a deployment, the workaround isn't enough** (the Frankfurt deployment, [DEPLOYMENT.md](DEPLOYMENT.md): three nodes of 4 vCPU, RivetKit 3.1.1 as published). The limit is per app node, so three nodes keep up to 12 calls in flight, and with the seeder's 16 at a time the directory's requests never reached zero. Its writes (sign-ups, then team members) fell from about 40 a second to 5 within 30 minutes, its process at 290% CPU; restarting it gracefully brought back about 21 a second, for a minute or two. With the fix, team members went at about 35 a second and ideas at 45 to 55 (22 on the laptop), the directory's process at about 35 to 40% CPU.
  - **With the fix** (`LOAD_RIVETKIT_FIX=1`, built by `rivetkit-fix/build.sh`): a call costs the same CPU at every concurrency. Seeding ideas ran at 27 to 29 a second instead of 10 to 15, with the app on 0.5 cores instead of 8 to 9, and directory reads meanwhile took 43 ms instead of 72 to 700 (10 ms with the limit raised to 16).

- **The directory's cost is its commits.** One connection, one thing at a time. A statement costs about 0.2 ms, but a commit that writes costs about 3.5 ms, and reads wait behind it: while ideas were seeded on the published build, a trivial `get_team` waited 700 ms. Fixed:
  - **The search index:** replacing an idea's row searched every row (FTS5 can't index its id column), 6.6 ms inside the transaction that registers a new idea. Rows are now found by an indexed table (`idea_search_rows`).
  - **The page cache:** 256 MB instead of SQLite's 8 MB. The directory was 47 MB at 25,000 ideas, and every page missing from the cache is fetched from the engine's storage.
  - **`create_idea`:** two directory calls instead of four. It read the team four times.
  - **Registration is batched:** new ideas are registered many in one commit, as notifications and index updates are (`server/src/actors/batch.ts`).
- **The engine's storage limits making many actors at once.** Bare new actors, each answering one read: about 80 a second with 8 at once (108 with `storage.max_background_cold_reads` raised from its default of 4 to 32), and about 50 with 32 at once, with a p99 of 15.3 s. The engine logged `QuorumUnavailable` on new actors' SQLite writes, and storage commands that failed; those retry until a timeout. That's for Rivet. At the design scale it matters only for bulk creation: 100,000 ideas accumulate over months.
- **Creating an idea is cheap alone.** With nothing else running, a whole `create_idea` takes 51 to 57 ms on the fixed build (105 to 134 ms on the published one); a comment afterwards 12 to 17 ms, an edit 19 to 24 ms. In bulk, seeding topped out at about 29 a second on the fixed build, whatever the concurrency: the actor-making limit above.

From the steady state on the same machine, with the directory on a node of its own (the deploy files' layout), all on mains power:

- **Measure on mains power.** On battery the laptop's CPU is throttled, and the same build did half the work: about 230 requests a second where it did 465 plugged in.
- **A page view is about 3.3 requests,** from the web app's own loaders: two lists on the home page, four reads on a team's page, the idea page's read and its comments and the people they name, and the inbox badge, which each open tab reads once a minute (0.9 a page view by itself).
- **Queues against actions** (RivetKit 3.0.6, the same data): below the limit the two are the same, in latency, CPU and the engine's SQLite commits (0.46 to 0.50 a request). At the limit, actions did about a fifth more (470 requests a second at 160 page views against 376), and under heavy overload they slowed where queues collapsed: at 190 page views, 3.9% failed against 26%.
- **RivetKit 3.1.1 against 3.0.6** (actions both, the engine on the same version as RivetKit):

  |                                                   | 3.0.6                          | 3.1.1                    |
  | ------------------------------------------------- | ------------------------------ | ------------------------ |
  | One VM, p95 at 90 / 110 / 130 page views a second | 2.3 s / 2.6–3.5 s / 3.6–6.3 s  | 196 ms / 501 ms / 1.34 s |
  | One VM, most requests a second                    | 350–370                        | 426                      |
  | Three app processes, at 130                       | 0.7–3.8% failed, p95 1.5–2.4 s | none failed, p95 152 ms  |
  | Three app processes, most requests a second       | 470                            | 507                      |
  | At 190 page views (heavy overload)                | 3.9% failed                    | 11.1% failed             |
  | The engine's SQLite commits a request             | 0.46–0.50                      | 0.47–0.68                |

  More app processes add little: one VM peaks at 426 requests a second and three at 507, as the directory's node (over 100% CPU at the peak) and the engine (about 250 to 300%) are the limit.

- **Fail-over** (the three-node Compose on one machine, `deployment/try-locally.yaml`, RivetKit 3.1.1): a crashed app node's actors are unavailable for about 45 s, the engine's lost threshold, even if Docker restarts it at once; one stopped with SIGTERM hands them over in about 0.3 s. Killing the directory's whole VM (its app, directory node and engine), everything answered again after 100 to 136 s, in 5 of 5 runs.

From the Frankfurt deployment (the full write-up of both sessions, with what each run ran: [reports/report1](reports/report1/); [DEPLOYMENT.md](DEPLOYMENT.md): three `m7i.xlarge` nodes of 4 vCPU and 16 GB, S3 in the same region, RivetKit and the engine 3.1.1, the app at `e6f8638` from the published images), its first session, 14 November 2026:

- **The three-node tier: about 120 page views a second, 130 at the edge** (about 400 to 430 requests a second; at the design scale's page a minute each, about 7,200 people all active at once). On RivetKit with the fix for rivet-dev/rivet#5991 (`app-bench`), two runs of `remote.sh steps`:

  | Page views a second | 100   | 110   | 120    | 130    | 140                  |
  | ------------------- | ----- | ----- | ------ | ------ | -------------------- |
  | First run, p95      | 85 ms |       | 94 ms  |        | 2.9 s, 371 dropped   |
  | Second run, p95     | 86 ms | 96 ms | 102 ms | 487 ms | 6.3 s, 1,093 dropped |

  Nothing failed in either. Below 100 the p95 hardly moves (77 ms at 40). **The limit is the directory's one thread:** its process at 100% of a core at 120 and 111% at 140, while each engine used 1 to 1.4 cores of 4, each app half of one, and the load machine 8% (so the page views k6 dropped past the knee were VUs waiting on slow answers, not k6 short of CPU). The node hosting the directory was at about 2.8 cores of 4.

- **On RivetKit as published** (`app`, the same build), one step less: 120 page views a second held with a p95 of 272 ms (93 ms at 100, 123 ms at 110), and 130 didn't (6.7 s, 0.09% failed, 2,577 dropped). The directory used about a tenth more CPU for the same work (103 to 112% against 92 to 101%). That understates the bug: these steps are 90 s and mostly reads, and seeding on it, sustained writes, slowed the directory from about 40 writes a second to 5 within half an hour.
- **Reading files from S3:** p50 about 26 ms and p95 50 to 57 ms, the same on all three nodes and at every rate. A page reads a version's files at once (`Promise.all`), beside the directory's access check, so it waits for about one read: about a quarter of opening an idea at the median (98 ms at 120 page views a second) and a third at the 95th percentile (160 ms). About two reads per idea opened.
- **What the engines ask of the buckets** (S3's request metrics, three engines):

  | An hour                 | At rest (30 min, just after `check` had woken every idea) | Under load (the three runs, about 100 page views a second) |
  | ----------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
  | Engine bucket: PUT      | 4,600                                                     | 34,400                                                     |
  | GET                     | 82,000                                                    | 170,000                                                    |
  | LIST                    | 1,770                                                     | 1,850                                                      |
  | DELETE                  | 19,000 (in bursts)                                        | 28,700                                                     |
  | Bytes read / written    | 72 MB / 16 MB                                             | 2.9 GB / 3.0 GB                                            |
  | Files bucket: GET, read | none                                                      | 108,000, 173 MB                                            |

  LISTs barely change with load: discovery runs on a timer (every 10 s per engine; leases are renewed every 3 s). The rest scales with use. At rest is probably high, so soon after waking every idea; a window long after any activity would give the floor.

- **Seeding the design scale: 37 minutes, nothing failed,** where the laptop took two hours: people 204 s, team members 130 s, ideas 23 minutes (1,382 s, 84 a second at first), comments 346 s (6.7 times the laptop's speed, as waking ideas spread over all three nodes). That was the second attempt. The first found five problems, each fixed but the last:
  - the files key was refused every new file: without `s3:ListBucket`, S3 answers 403, not 404, for an object that isn't there (#46);
  - every actor ran on one node: each node's image took its node version from its build time, and the engine gives actors only to the highest version (#47);
  - an engine stopped itself on "Too many open files": Docker on Ubuntu allows a container 1024 (#47);
  - on RivetKit as published, the directory slowed to an eighth of its pace (above);
  - 20 new ideas were left with databases that never open ("database disk image is malformed", "file is not a database"), created just after an engine restarted: once after it stopped itself, once from a graceful restart. None had been acknowledged. Rivet's, and not reported; `remote.sh check` found no damage on the second seed.
- **Restoring the seed works** (snapshots of the nodes' disks, copies of the buckets): the data answered with nothing failed. But `aws s3 sync` between buckets missed 54 of the engine bucket's 7,376 objects, its cluster records, rewritten at the same size; and a disk made from a snapshot is slow until read through (an idea's page took 7.4 s at the 95th percentile). [DEPLOYMENT.md](DEPLOYMENT.md) now checks every object and reads the disks first.

## A crowd in one draft

`src/draft-crowd.ts` measures one live draft rather than the site: how many browser windows can type in the same idea at once before typing lags. It sets the default for `limits.draft.editors`, and is how a deployment finds what its own hardware takes. Every keystroke and caret goes to everyone in the draft through the idea's one actor, which takes one write at a time, so it's the speed of one core that counts.

Each window does what the page editor does, without a browser: the draft's socket, the editor's own document and collab, a keystroke at the end of a paragraph of its own every so often, and its caret after each. It signs up a person of its own by email code, so it needs Mailpit, and works against any running app: this stack, or `scripts/test-ui.sh`'s. The app's limit has to be above the largest crowd, or windows past it only read along.

```sh
# on the app: IDEAF__LIMITS__DRAFT__EDITORS=1000
LOAD_APP_URL=http://localhost:18080 LOAD_MAIL_URL=http://localhost:18025 \
  bun packages/load/src/draft-crowd.ts --windows 5,10,20,40,80 --seconds 30 --cps 3
```

For each crowd it reports how long a keystroke takes to be stored and come back (what turns the saving line back to Saved, and about when the others see it), how many sends were behind and went again, and how long a caret takes to come back from the actor. Afterwards it reads the draft back: "all there" when every keystroke confirmed is in it once, in its own paragraph.

On a laptop (Intel Core Ultra 9 185H, on mains power; the app in Docker, one node), every window typing at 3 keystrokes a second, two runs each on fresh data, 2026-11-24. Each cell is the range over the two runs, and both were all there:

| Windows | Keystrokes a second | Stored, p50 | p95          | p99       | Behind | Caret, p95 |
| ------- | ------------------- | ----------- | ------------ | --------- | ------ | ---------- |
| 20      | 60                  | 5 ms        | 10–14 ms     | 16–820 ms | 26–32% | 2 ms       |
| 40      | 120                 | 6–22 ms     | 30 ms–2.3 s  | 0.9–4.7 s | 54–90% | 2–3 ms     |
| 50      | 150                 | 10–17 ms    | 120 ms–4.4 s | 1.1–7.7 s | 73–89% | 3–4 ms     |
| 80      | 240                 | 2.0–2.3 s   | 15–16 s      | 26–27 s   | 99%    | 20–27 ms   |

Twenty windows hold. Forty and fifty are where typing starts to fail: most keystrokes are still stored at once, but in each run one of the two had a p95 past two seconds. A send that's behind is answered at once, without waiting its turn, so the actor's turns go to storing keystrokes; but it stores one window's at a time, and each takes about one write to SQLite, about 3 ms. In one run of two, 20 windows also had one stall of about a second (the p99), not yet explained. Carets never come close. The app used about one and a half cores throughout. On battery the laptop throttles and typing falls apart at 20 windows, so measure on mains power. A cloud vCPU is slower per core than this laptop, so 20, the default, may be near the edge there: run this on the deployment to check.

## Settings

| Variable                                                 | Default                       |                                                                   |
| -------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| `LOAD_RATE`                                              | 167                           | page views a second                                               |
| `LOAD_DURATION`                                          | 10m                           | how long each scenario runs                                       |
| `LOAD_VUS`                                               | 300                           | VUs kept ready for page views (up to four times as many are used) |
| `LOAD_BOTS`                                              | 50 (`burst`), 0 (`steady`)    | bots                                                              |
| `LOAD_AUTH`                                              | `jwt`                         | `token` for personal tokens                                       |
| `LOAD_PEOPLE`, `LOAD_TEAMS`, `LOAD_GROUPS`, `LOAD_IDEAS` | 10,000, 1,000, 2,000, 100,000 | the seed's scale; a seed at another scale needs `wipe` first      |
| `LOAD_CONCURRENCY`                                       | 16                            | the seeder's requests in flight; more makes it slower             |

These are one-host numbers: the load generator, the app, the engine and SeaweedFS all share one machine's CPU and disk.
