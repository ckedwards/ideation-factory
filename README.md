# Ideation Factory

Review and edit ideas written in Markdown, together with agents, so comments stay with the text they're about. Licensed under Apache-2.0.

> **Alpha software.** Nothing has shipped yet, and there are no migrations during the alpha: schemas and APIs change in place, so data from an earlier build won't carry over to a later one.

## Docs

- [The idea](docs/idea.md) and the [market analysis](docs/market-analysis.md)
- [Architecture](docs/architecture.md) and the [cli](docs/cli.md)
- [MVP design](docs/mvp/architecture.md): [backend](docs/mvp/architecture-backend.md), [front end](docs/mvp/architecture-frontend.md), [cli and skills](docs/mvp/architecture-cli.md), [core](docs/mvp/core.md), [scale concerns](docs/mvp/scale-concerns.md), and the [Rivet](docs/mvp/spike-rivet.md) and [Better Auth](docs/mvp/spike-better-auth.md) spikes
- [Implementation plan](docs/implementation-plan.md): where to start, and in what order

The prototypes are in `experiments/`.

## Contributing

Commit messages follow [CONTRIBUTING.md](CONTRIBUTING.md) (adapted from Angular's guidelines), checked by a commit-msg hook that `bun install` turns on, and by CI. Agents read [AGENTS.md](AGENTS.md).

## Code

Bun workspaces, all TypeScript:

```
packages/
  core/     schemas, edit commands, Markdown blocks, anchoring, hashing, links
  api/      each operation defined once: HTTP routes, MCP tools, a typed client
  server/   the Bun app: HTTP and MCP, auth, the idea and directory actors
  ui/       React components, design tokens and themes; shown in Storybook
  web/      the React app: routes, pages and data loading, built from ui
  cli/      ideaf
  e2e/      end-to-end tests: the cli against the real server
```

You need [Bun](https://bun.sh), and Node for Storybook. Docker is only for the [Rivet spike](docs/mvp/spike-rivet.md).

```
bun install
bun run dev          # the server on http://localhost:8080
bun run typecheck
bun run test
bun run engine:stop  # stop the local Rivet Engine
```

Until real sign-in (step 6), the server takes a dev token: `Authorization: Bearer dev` signs you in as "dev", and `Bearer dev:maya` as "maya", so several people can be tried (set `IDEAF_DEV_TOKEN` to change the `dev` part). For example:

```
curl -H 'authorization: Bearer dev' -X POST localhost:8080/ideas \
  -d '{"title":"Demo","files":[{"path":"plan.md","content":"# Plan\n\nHello.\n"}]}'
# → {"idea":"i…","version":1}
curl -H 'authorization: Bearer dev' localhost:8080/ideas/<idea>/blocks
```

With the dev server running, the cli works the same way (`bun run --filter @ideaf/cli build` makes `packages/cli/dist/ideaf`, or run `bun packages/cli/src/main.ts`):

```
export IDEAF_TOKEN=dev
ideaf start docs --title "Offline mode"   # an idea from the Markdown in docs/
ideaf show --blocks                       # sections and blocks with their IDs
ideaf edit batch.json --dry-run           # what a batch would do, and to each comment
ideaf edit batch.json                     # one new version
ideaf pull                                # the result into your files (3-way merge)
ideaf sync                                # your local edits back up, with their bases
```

Every route is described at `/openapi.json`. From code, use the typed client: `createApiClient({ baseUrl, token })` from `@ideaf/api`.

The Markdown size limits default to 256 KB per file and 2 MB per idea; `IDEAF_MAX_FILE_BYTES` and `IDEAF_MAX_IDEA_BYTES` change them (until the site admin page exists).

**Several worktrees at once** (for example one per agent): each worktree gets its own data folder, Rivet Engine port and dev server port, so they never share an engine or each other's actors. The main worktree uses the defaults (engine 6420, server 8080); a linked worktree gets fixed ports derived from its path. `bun run worktree` shows them, and `eval "$(bun scripts/worktree.ts env)"` sets `IDEAF_URL` and the rest in a shell. `bun run dev`, `bun run test` and `bun run engine:stop` use them automatically, and `engine:stop` only stops this worktree's engines. Tests get an engine of their own, with fresh data in `.data/test` for every run, stopped when they finish.

```
git worktree add ../ideation-factory-auth -b spike/better-auth
cd ../ideation-factory-auth && bun install && bun run worktree
```

In development RivetKit starts a local Rivet Engine itself and keeps its data in `.data/` (in each worktree), with file contents in `.data/files/`; delete that folder to start fresh. Use `bun run test` rather than plain `bun test`: the actor tests refuse to start without this worktree's settings. The dev engine keeps running after the server exits; `bun run engine:stop` stops it.
