# Ideation Factory MVP: scale concerns

**Status:** working list. The performance risks still open after the design decisions so far, with what's planned for each. The design targets are in the root `architecture.md` (Scale): about 10,000 people, 1,000 teams, 2,000 groups and 100,000 ideas, with bots producing most of the traffic. The backend design is in [backend](architecture-backend.md); open platform questions are in the [Rivet spike](spike-rivet.md).

## Already handled

| Concern | How |
|---|---|
| **Checking who's calling** on every request | 15-minute signed access tokens, checked by signature on any node. Long-lived sessions and tokens are read from the directory actor only when one is issued or refreshed: about 11 reads a second for 10,000 active clients |
| **MCP token checks** | The same signed tokens, issued through OAuth (Better Auth's MCP plugin, if the [Better Auth spike](spike-better-auth.md) passes) |
| **Concurrent writes to one idea** | One actor per idea applies them one at a time from its queue, with no locks |
| **Live updates to many viewers** | Each idea actor broadcasts to its own connected viewers |
| **Storage growing with versions × files** | File contents are stored once per distinct content (in the bucket, keyed by hash); a version is a small manifest |
| **Loading everything** | Every list is paged on the server, 25 at a time, with cursors; large sets are picked by type-ahead |

## Open concerns

In rough order of how likely each is to bite. Severity: **High** means likely to show up at design scale, or in a bot burst. **Medium** means it shows up for heavy users or large ideas. **Low** means narrow.

| # | Concern | Severity | Where |
|---|---|---|---|
| 1 | Writes to the directory when bots get busy | High | Directory actor |
| 2 | Checking access on every read | High | Directory actor, idea actors |
| 3 | Rate limiting needs somewhere to count | High | App nodes, actors |
| 4 | Heavy work in one actor stalls its node | High | Idea actors, app nodes |
| 5 | The inbox's read-time merge | Medium | Directory actor |
| 6 | Search and counts | Medium | Directory actor (FTS5) |
| 7 | Big groups as reviewers | Medium | Directory actor (inboxes) |
| 8 | The directory actor is the one shared owner | Medium | Directory actor, engine |
| 9 | Loading versions from the bucket | Low | Bucket, app nodes, web app |
| 10 | Reaching and waking actors | Low | Engine, actors |
| 11 | One-off actor calls cost about 80 ms each | High, if it holds in production | App nodes, engine gateway |

### 1. Writes to the directory when bots get busy

**Why:** every change to an idea (a comment, a version, a review, a status change) updates its index row in the directory actor and writes inbox rows for direct participants. The directory actor is one SQLite database that applies writes one at a time from its queue. Reads run as parallel actions, but SQLite still serializes them against writes, so a burst of writes also slows lists and search. Rivet's hard limits apply too: at most 128 operations can wait behind an active transaction (more fail with `sqlite.transaction_queue_full`), and an actor's queue holds 1,000 messages by default. And Rivet Engine 3.0 refuses an actor's writes for a moment when its storage lane is full (`sqlite storage is overloaded, retry after 500 ms`), which CI hit once the inbox made every idea write a directory write as well: under a second each time, but every request in that window failed.

Each commit writes the pages it changed, and the same pages (an inbox's rows, the events' index) change on every notification, so commits, not rows, are what costs. 50 notifications written one transaction each wrote 263 pages; in one transaction, 9.

**When it bites:** a burst of bot activity, for example an agent reviewing a dozen ideas and posting hundreds of comments. That becomes a burst of small directory writes, queued behind each other.

**Mitigations:**
- **Coalesce index updates per idea:** the idea actor writes its index row at most every few seconds, not on every event.
- **Batch inbox writes:** one call and one statement per event, not one per recipient, and a queue batch's notifications (up to 50) in one transaction, as its index updates are.
- **Retry when storage is busy:** wait as the engine asks and try again, a statement or a transaction whole (`sql/retry.ts`; Better Auth's transactions are replayed from their statements).
- **Review batching** (a TODO in `architecture.md`): a bot submits one review instead of many separate comments.
- **Keep transactions short** so little waits behind them, and treat a full queue as back-pressure (a retryable error), never a lost write.
- **If it's still too much,** split the directory (concern 8).

**Status:** coalescing built in step 5 (one index update per idea about 2 seconds after its last change, sent without waiting, applied in batches with only the newest kept). Inbox batching built with the inbox (step 9, part 4a): each queue batch's notifications in one transaction, then its index updates in another. Retrying refused writes built too, for up to 10 seconds. Measure in the load test how often storage refuses writes and how long the retries wait: if it's often, the writes need cutting further, or the directory splitting (concern 8).

### 2. Checking access on every read

**Why:** authentication no longer needs the directory, but authorization does. Access is per idea, through grants to people, groups, a team's members or everyone, so lists and search join each idea's grants against your group and team memberships. This is now the main directory read on most requests.

**When it bites:** busy list, search and inbox pages, and agents making many small read calls.

**Mitigations:**
- **Inside an idea:** its actor keeps its own grants, and the member lists of the groups and team they name, cached, refreshed when a grant or membership changes.
- **In lists:** the visibility filter is part of the indexed query, not a check on each idea afterwards.
- **Keep the per-idea split strict:** anything about one idea comes from its actor, never from the directory.

**Status:** the list and search filter is built into the indexed query (step 5). The per-idea check is one indexed directory read per request for now; caching grants and member lists in the idea actor is still to do, if measurement says it's needed.

### 3. Rate limiting needs somewhere to count

**Why:** we've promised per-token limits (stricter for bots) and a per-idea cap on comments per minute. A counter in the directory would be a write on every request, which is far worse than the auth read the signed tokens removed.

**Mitigations:**
- **The per-idea cap lives in the idea actor,** which sees every comment anyway.
- **Per-token limits:** counters in memory on each app node (approximate, and fine for abuse protection), or a small actor per busy token for exact limits.
- **Check what Better Auth does** for sign-in, email codes and token endpoints, and where it keeps its counters (in the Better Auth spike).

**Status:** open.

### 4. Heavy work in one actor stalls its node

**Why:** re-anchoring comments after an upload, replaying edit batches and dry runs are CPU work. An app node is one Bun process hosting **many** actors on one JavaScript thread, so a long computation in one idea actor also delays every other actor and request on that node, not just that idea.

**When it bites:** a large idea (dozens of files, hundreds of comments) uploaded or edited repeatedly.

**Measured** (step 1's `core`, on a laptop; see [core](core.md)):

| Work | Typical idea (3 files, 7 KB) | Large idea (40 files, 890 KB, 500 comments) |
|---|---|---|
| Upload with every file edited | ~7 ms | ~0.7 s, or ~1.5 s if the old version isn't parsed yet |
| A batch of 20 steps | | ~0.5 s (~25 ms a step) |

Parsing is most of it: the Markdown parser takes ~715 ms for the large idea, more than half of that for GitHub's extensions (tables, task lists, footnotes). Diffing and following IDs and comments take ~150 ms. Cost grows with size, so a typical idea is no problem and a large one stalls its node for up to a second or two.

**Mitigations** (to build in step 2, when the idea actor starts calling `core`):
- **Run `core` in a pool of Bun worker threads** on each app node. `core` has no shared state, so the main thread only passes messages. This is the real fix: a large upload then slows only its own idea.
- **Size limits, set by site admins:** a maximum Markdown file size (default 256 KB) and idea size (default 2 MB), checked before parsing (see Deployment settings in the [overview](../architecture.md)). They cap the worst case at a few seconds of worker time.
- **Keep the latest version parsed in the actor's memory,** so a change only parses the new text.
- **Only touch what changed:** already done in `core`. A batch step only follows the files it touches, and an upload only diffs files whose text changed.
- **Very large work in the background,** if workers and limits aren't enough: the actor schedules it, and marks the version "processing" until it's done.

A faster parser is the other option, but the web app must parse with the same libraries so comment positions agree, so that's only worth it if measurement says workers and limits aren't enough.

**Status:** worker pool, size limits and in-memory latest version built in step 2. On the large idea, an upload's main-thread stall went from 901 ms (in process) to at most 2 ms (through the pool); the upload itself still takes about 0.9 s of worker time (1.9 s the first time a worker sees the idea). To be confirmed under load in the [Rivet spike](spike-rivet.md) ("Heavy work on one node").

### 5. The inbox's read-time merge

**Why:** team watchers aren't written one row per event; a watcher's inbox merges each watched team's activity when it's read. That keeps writes cheap, but shifts the cost to reads.

**When it bites:** someone watching many busy teams, since every inbox load scans more.

**Mitigations:** keep unread counts per team, cap how far back the merge looks, and index team activity by team and time.

**Status:** open.

### 6. Search and counts

**Why:**
- **Short searches:** the FTS5 trigram index can't serve searches under three characters, so those would scan everything.
- **Totals:** exact totals on every list page ("1,967 ideas") cost real work on large filtered sets.
- **FTS5 itself** must be available in the actor's SQLite (to confirm in the Rivet spike).

**Mitigations:**
- Require three characters: a search needs a word of at least 3 characters, and shorter words in it are ignored (decided in step 5; common for search, and it means no full scans).
- Make large counts approximate ("about 4,000"), which is already an open question in `architecture.md`, or keep cached counters.

**Status:** the three-character rule is built (step 5), and access is filtered inside the search query. A work cap, like Elasticsearch's `terminate_after`, bounds the worst case: a search reads at most 20,000 matches (the most recently updated) and returns `incomplete: true` if there were more. A cap on work rather than time keeps answers the same however busy the directory is. Measured at 100,000 ideas: about 14 ms for a word in 10% of titles, about 24 ms for a word in every title (about 100 ms before the cap). If people search common words a lot, the next step is access data in the search index itself, as Elasticsearch's document-level security does. Lists page with cursors and don't count totals yet.

### 7. Big groups as reviewers

**Why:** asking a 50-person group to review writes 50 inbox rows, on every update to that idea. That multiplies concern 1.

**Mitigation:** decided: every member hears about it as if asked by name, so the experience doesn't depend on the group's size. The writes go through the directory's queue, off the request path, one statement per event for all its recipients, and inboxes bundle per idea. If that gets slow for very big groups, move them to the read-time merge team watchers use (concern 5): the work moves, what members see doesn't.

**Status:** queued fan-out built (step 9, part 4a). Measure in the load test.

### 8. The directory actor is the one shared owner

**Why:** there are many idea actors, spread across nodes, but only one directory actor. Everything shared goes through it, on whichever node is hosting it.

**When it bites:**
- **Throughput:** if concerns 1, 2 and 5 together exceed what one SQLite database applying its writes one at a time can do.
- **Hops:** most requests land on a node that isn't hosting it, so the call crosses the private network.
- **Fail-over:** if its node fails, everything shared waits until the engine moves it to another node: 40 seconds to declare the node lost, plus the restart, so up to about a minute (see the [Rivet spike](spike-rivet.md)).

**Mitigations:** the signed tokens, the per-idea split and the coalescing above. Only if needed, split it: an actor per person (inbox, watch settings) and per team (members, the team's idea list), leaving the directory actor with search and type-ahead. For a customer who'd rather run Postgres, the directory can be swapped for it, which removes the single owner. See "The directory actor is the one shared owner" in the backend doc.

**Status:** the `Directory` interface, Kysely queries for SQLite and Postgres, search behind its own interface, and a contract test suite are built (step 5), so a Postgres version is an added implementation. The Rivet spike measures what one directory actor can sustain.

### 9. Loading versions from the bucket

**Why:** showing a multi-file idea means fetching many files; a compare needs two versions' worth.

**Mitigations:** fetch files in parallel, and cache them indefinitely, because a file stored by its content hash never changes. That means a cache in memory or on local disk on each app node, and `immutable` caching headers for browsers.

**Status:** low priority.

### 10. Reaching and waking actors

**Why:** a call to an actor goes through the engine to wherever it runs, and an idle actor sleeps (hibernates) and has to wake up first. Rivet quotes waking in a few milliseconds, but a page that touches several sleeping idea actors pays it several times.

**Mitigations:** pages that span ideas read the directory's index, not the idea actors; only an idea's own page wakes its actor.

**Status:** low priority; measure in the Rivet spike.

### 11. One-off actor calls cost about 80 ms each (fixed in RivetKit 3.0)

**Why:** the app node calls actors through RivetKit handles (`actors.idea.getOrCreate([id]).summary()`). Each call is one HTTP request to the engine's gateway, which relays it to the actor's process over a WebSocket. On RivetKit 2.3.31 each one took about 88 ms, whatever it did, while the same action over a connection (`handle.connect()`) took about 2 ms. Every API request makes at least two calls (the access check in the directory, then the idea), so this was most of every request's time, and most of the test suite's: 136 s, of which about 21 s was CPU.

**Cause:** traced with debug logging (2026-11-01). The relay sends a request's start and its body as two small WebSocket frames, and the reply the same way back; each second frame arrived about 40 ms after the first. Two 40 ms stalls is the mark of Nagle's algorithm waiting on a delayed ACK (a socket without `TCP_NODELAY`), on the link between the engine and the actor's process. Not a development setting, so it would have held in production too.

**Fixed** by RivetKit 3.0.0 (with its engine), measured the same way on one machine:

| Call | 2.3.31 | 3.0.0 |
|---|---|---|
| Action through a handle, by key (what the server does) | ~88 ms | ~4 ms |
| 10 actions at once | ~106 ms | ~12 ms |
| Action over a connection | ~2–5 ms | ~2 ms |
| `getIdea` through the HTTP API | ~150 ms | ~11 ms |
| `addComment` (a queued write) | ~350 ms | ~58 ms |
| `createIdea` | ~550 ms | ~106 ms |
| The whole test suite | 136 s | 28 s |

**Mitigations, if one-off calls get slow again:** keep connections open from each app node: one to the directory, and connections to idea actors cached by idea, closed after about a minute idle (so actors still sleep), and dropped when the actor goes away. Measured on 2.3.31 as a quick experiment: the suite went from 136 s to 52 s.

**Status:** fixed by the upgrade. Measure again on a production-like setup in the [Rivet spike](spike-rivet.md) ("Call latency").

## Load test plan

Before launch, on both deployment shapes:

| Scenario | What it exercises | Watch |
|---|---|---|
| **Steady state:** 10,000 people's worth of list, search, inbox and idea-page traffic | Concerns 2, 5, 6, 8 | Latency at the 50th and 99th percentile; the directory actor's queue and query time |
| **Bot burst:** agents posting hundreds of comments and edit batches across many ideas | Concerns 1, 3, 4 | Directory write backlog and pages written per commit, how often storage refuses writes and how long retries wait, rate limits engaging, event-loop delay on app nodes |
| **Large idea:** dozens of files and hundreds of comments, uploaded and edited repeatedly | Concern 4 | Re-anchoring time, worker threads, other actors' responsiveness on the same node |
| **Big group review:** a 50-person group on a busy idea | Concerns 1, 7 | Inbox writes per event |
| **Three-node cluster:** steady state plus the bot burst, then stop the node hosting the directory actor | Concern 8 | Hop cost, how long until the directory answers again |
| **One VM:** steady state, then restart the VM | Concerns 8, 10 | Restart time, whether any acknowledged writes were lost |

## Sources and related docs

- `architecture.md` (Scale): the design targets, storage and notification fan-out.
- [Backend](architecture-backend.md): auth and access (15-minute tokens), and self-hosting.
- [Rivet spike](spike-rivet.md): the platform questions behind concerns 4, 6, 8, 10 and 11.
- [Better Auth spike](spike-better-auth.md): sign-in, tokens and MCP.
