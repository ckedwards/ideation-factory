# Ideation Factory

TypeScript on Bun, with Rivet actors. The design is in `docs/`; build order and status in `docs/implementation-plan.md`.

## Alpha

This is alpha software: nothing has shipped, so there's no backward compatibility to keep, and **no migrations during the alpha**.

- A schema change edits the v1 migration in place (`packages/server/src/idea/schema.ts`, `packages/server/src/directory/schema.ts`) and re-freezes it: delete `packages/server/src/migrations/frozen/<schema>-v1.sql`, then run `bun packages/server/src/migrations/freeze.ts`. Never append a v2.
- Local data from before a schema change won't match it: run `bun run engine:stop` and delete the worktree's `.data/`. Tests always start from fresh data.
- APIs, schemas and stored formats change freely, with no compatibility shims or deprecation paths.

## Commits

Every commit message follows `CONTRIBUTING.md`; a hook and CI check it, and `bun scripts/commit-lint.ts --message "…"` checks one before committing.

- Title: `<type>(<scope>): <summary>`, summary in the imperative, lowercase start, no full stop.
- Types: `build`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `test`, `revert`. Tooling in `scripts/` is `build(dev-infra)`; test infrastructure is `test`.
- Scope: the package changed (`core`, `api`, `server`, `cli`, `ui`, `web`, `e2e`, `load`, `dev-infra`); none for changes across packages or for `docs`.
- Body: why the change was made, at least 20 characters (all types but `docs`).
- Breaking changes: `!` in the title (`feat(api)!: …`) and a `BREAKING CHANGE:` footer with what breaks and how to migrate.

## Pull requests

Pull requests are squashed or rebased, never merged with a merge commit. A squash merge makes the pull request's title the first line of the commit on `master`, so the title follows the same rules as a commit's first line, with `!` when any of its commits has a `BREAKING CHANGE:` footer. CI's `title` job checks it; `bun scripts/commit-lint.ts --title "…" master..HEAD` checks one before opening the pull request.

## Code

Every body of `if`, `else`, `for`, `while` and `do` is a block in braces, on its own lines. oxlint and oxfmt check it in a pre-commit hook and in CI; `bun run format` fixes it.

## Secrets

No secrets in the repository: it's public. Betterleaks (`scripts/secrets.sh`) checks what's staged in the pre-commit hook and the branch's whole history in CI; an exception for a test fixture or placeholder goes in `.betterleaks.toml`, limited to its rule and file, with why.

## Workflows

Actions used in `.github/workflows/` are pinned in `.github/workflows/actions.lock`. After changing a workflow, run `gh actions-lock` and commit the lockfile with it; the pre-commit hook and CI refuse a workflow whose actions aren't pinned.

## Running things

- The app: `bun run dev` runs the server and, behind it, the web app's Vite, on this worktree's ports; the browser only talks to the server.
- Tests: `bun run test`. It gives this worktree a fresh Rivet Engine of its own; the actor tests refuse to start under plain `bun test`.
- Each worktree has its own engine and ports (`bun run worktree` shows them). RivetKit reads its settings from the environment before any code runs, so start processes through `bun scripts/worktree.ts exec -- …` rather than setting `process.env`.
- RivetKit's `onMigrate` already runs in a savepoint: migrations run their statements without a transaction of their own.
