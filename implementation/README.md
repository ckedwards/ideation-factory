# Implementation plan

**Status:** plan. Where to start building the backend, and in what order. The design it builds is in `mvp/`: [overview](../mvp/architecture.md), [backend](../mvp/architecture-backend.md), [cli and skills](../mvp/architecture-cli.md), [front end](../mvp/architecture-frontend.md), and [scale concerns](../mvp/scale-concerns.md).

## Where to start

**Start with the edit-command engine and comment anchoring, as pure TypeScript with no server.** Then wrap it in a thin vertical slice, so the whole agent loop works early.

- **It's the riskiest piece:** block IDs, the plain-text form comments are matched in, applying batches, conflicts, and re-anchoring uploads. If that's wrong, nothing else matters. If it's right, the rest is fairly standard web-app work.
- **It needs no platform.** It's pure functions, so it can be built test-first and is unaffected by the open questions in the [Rivet](../mvp/spike-rivet.md) and [Better Auth](../mvp/spike-better-auth.md) spikes.
- **Test data already exists:** the prototypes' offline-sync idea (versions, a moved section, outdated comments) and the `mvp/` docs themselves make good fixtures.
- **Auth is the obvious first step, but not the right one here.** It's commodity work, and the [Better Auth spike](../mvp/spike-better-auth.md) hasn't decided it yet. Starting there would postpone learning on the parts that could sink the project.

## Sequence

| Step | What | What it proves |
|---|---|---|
| **0. Skeleton** | Bun workspaces with `core`, `api`, `server`, `web` and `cli` (the layout in the overview's "One codebase"); typecheck and tests in CI; RivetKit with a local Rivet Engine (3.0 preview) running, with its local file-system store, plus SeaweedFS as a local S3-compatible bucket for our files; idea-actor writes go through a queue from the start | The repository shape works, and the platform runs on a laptop |
| **1. `core`** | Markdown blocks and sections with stable IDs; the plain-text form with a map back to source positions; content hashing; the edit commands (`replace`, `move`, `rename-heading`, …) as a pure function from files plus a batch to new files, comment moves and conflicts; re-anchoring an upload from its base | **The differentiator works,** with golden tests: "the comment survives a move", "duplicated text stays with its own copy", "a stale batch conflicts", "a rewritten sentence's comment becomes outdated" |
| **2. Idea actor** | Create an idea; store a version (its manifest in the actor's SQLite, file contents in the bucket by hash); comments; apply a batch with `core`; live updates to connected viewers. One hard-coded dev token for now. Keep the idea logic in a plain `IdeaService`, with the actor as a thin shell | The consistency model and storage design hold up |
| **3. `api`** | The operation registry (schemas producing routes and a typed client) for a minimal set: create an idea, sync (with base hashes and "pull first"), pull, show blocks, edit (dry run and apply), comments | "Define each operation once" works |
| **4. A thin cli** | `ideaf start`, `sync`, `show --blocks`, `edit --dry-run`, `edit` and `pull`, against the local engine | **The agent loop, end to end** |
| **In parallel: the Better Auth spike** | One week, as written up | Decides sign-in, tokens and the MCP path |
| **5. Directory actor** | Users, teams and memberships; the idea index, written by idea actors and coalesced from the start; lists, search and visibility. All behind a `Directory` interface, with SQL that would also run on Postgres, search behind its own interface, and writes correct under concurrency (constraints, not queue order) | Scale concerns 1, 2, 6 and 8, built in rather than retrofitted; Postgres stays a cheap escape hatch |
| **6. Real auth** | Whatever the spike decides: email codes, passkeys, 15-minute signed tokens | |
| **7. Web app** | Port the prototypes' UI (`experiments/`) onto the API | |
| **8. The rest** | Reviews and approvals, the inbox, the hosted MCP server (from the same operation registry), Docker Compose for one VM and three VMs, then the load test in scale concerns | |

## First milestone: a walking skeleton

The demo for the pitch, with no UI, no real auth and no directory yet, all on a laptop (local engine and SeaweedFS) with a dev token:

1. `ideaf start`, then `ideaf sync` a folder of Markdown.
2. Add a comment on a section, through the API.
3. `ideaf edit` a batch that moves that section and rewords it. The comment follows.
4. `ideaf pull` the result into the repository.

## Decisions to make early

Each is hard to change once there's data:

1. **Block IDs:** how they're assigned and kept across versions, and how files get IDs, so renames work.
2. **The source map:** the Markdown parser's positions (mdast) give the map from plain text back to source. Settle the library now, because the web app has to use the same one to place comments.
3. **What's stored where:** the idea actor's tables (versions, steps, comments, an anchor per version), and the version manifest format.
4. **The batch format,** as a JSON Schema, because the cli, MCP and the web app all produce it.

## Testing approach

- **Golden tests for `core`:** fixtures of "before" files, a batch or an upload, and the expected files, comment positions and states (exact, moved, changed, outdated).
- **Shared fixtures:** the cli and the server use the same `core`, so content hashing and batch validation are tested once.
- **A large-idea fixture** (dozens of files, hundreds of comments), for scale concern 4.
