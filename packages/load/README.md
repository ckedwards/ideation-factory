# Load test

k6 against the [one-VM Compose](../../deploy/one-vm), on one machine, at the design scale in [scale concerns](../../docs/mvp/scale-concerns.md#load-test-plan): 10,000 people, 1,000 teams, 2,000 groups and 100,000 ideas.

```sh
packages/load/run.sh up       # the one-VM Compose, plus Mailpit, as project ideaf-load
packages/load/run.sh seed     # the data, through the API (resumable: run it again to carry on)
packages/load/run.sh steady   # the steady state
packages/load/run.sh burst    # the steady state with bots
packages/load/run.sh down     # stop, keeping the data; `wipe` deletes it and the seed too
```

`up` writes `.data/load.env` the first time, with new secrets. The site is at https://localhost:18443 (Caddy's local CA), Mailpit at http://localhost:18025. The seeder reaches the app directly at http://localhost:18080.

**Against a deployment** (the three-VM Compose on Hetzner with S3 in Frankfurt for everyday benchmarks, or on AWS in the US to check production), from a machine of its own: `remote.sh`, with the same commands. [DEPLOYMENT.md](DEPLOYMENT.md) says what to make, how to set it up, how to keep the seed, and what it costs. Benchmarks are better made that way: one laptop's CPU throttles on battery and when hot, and a day of runs on one drifted more than the changes they measured.

## What it does

**Seeding** (`src/seed.ts`) signs each person up the way people do: it asks for a code, reads the email from Mailpit and signs in. It then gets each person a personal token. After that, the people make teams and groups, add members, and create ideas, share some with groups and comment on some. Who's in which team, and which ideas each team has, is worked out from indexes in `src/model.ts`, so the k6 script doesn't need tables to find them:

|        |                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------- |
| People | `p0` … `p9999`, each in three teams                                                                                 |
| Teams  | `t0` … `t999`, each made by its first admin, who also makes its ideas                                               |
| Groups | `g0` … `g1999`, ten people each                                                                                     |
| Ideas  | 100 per team, a 2 KB Markdown file each; one in ten shared with a group, and another one in ten with three comments |

What's been made is kept in `.data/seed.json`: IDs, and each person's session cookie and personal token. At full scale, seeding takes about … (see the results).

**Rate limits stay on.** Every request carries its person's own address in `X-Forwarded-For` (`10.x.y.z`). The app trusts that header because the request comes from the Docker network, which the one-VM Compose lists in `IDEAF_TRUSTED_PROXIES`. So the limits count people apart, as they would count real people behind Caddy.

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
  - **Workaround, in production until a release has the fix:** each app node sends the directory at most 4 calls at once (`server/src/actors/limit.ts`, `IDEAF_DIRECTORY_CALLS`). The same writes then ran at about 220 a second on 1.5 cores, at 16, 64, and 64 held for 90 s.
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

- **Fail-over** (the three-VM Compose on one machine, RivetKit 3.1.1): a crashed app node's actors are unavailable for about 45 s, the engine's lost threshold, even if Docker restarts it at once; one stopped with SIGTERM hands them over in about 0.3 s. Killing the directory's whole VM (its app, directory node and engine), everything answered again after 100 to 136 s, in 5 of 5 runs.

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
