# Ideation Factory

TypeScript on Bun, with Rivet actors. The design is in `docs/`; build order and status in `docs/implementation-plan.md`.

## Commits

Every commit message follows `CONTRIBUTING.md`; a hook and CI check it, and `bun scripts/commit-lint.ts --message "…"` checks one before committing.

- Title: `<type>(<scope>): <summary>`, summary in the imperative, lowercase start, no full stop.
- Types: `build`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `test`, `revert`. Tooling in `scripts/` is `build(dev-infra)`; test infrastructure is `test`.
- Scope: the package changed (`core`, `api`, `server`, `cli`, `ui`, `web`, `e2e`, `dev-infra`); none for changes across packages or for `docs`.
- Body: why the change was made, at least 20 characters (all types but `docs`).
- Breaking changes: `!` in the title (`feat(api)!: …`) and a `BREAKING CHANGE:` footer with what breaks and how to migrate.

## Running things

- Tests: `bun run test`. It gives this worktree a fresh Rivet Engine of its own; the actor tests refuse to start under plain `bun test`.
- Each worktree has its own engine and ports (`bun run worktree` shows them). RivetKit reads its settings from the environment before any code runs, so start processes through `bun scripts/worktree.ts exec -- …` rather than setting `process.env`.
- RivetKit's `onMigrate` already runs in a savepoint: migrations run their statements without a transaction of their own.
