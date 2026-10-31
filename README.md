# Ideation Factory

Review and edit ideas written in Markdown, together with agents, so comments stay with the text they're about. Licensed under Apache-2.0.

## Docs

- [The idea](docs/idea.md) and the [market analysis](docs/market-analysis.md)
- [Architecture](docs/architecture.md) and the [cli](docs/cli.md)
- [MVP design](docs/mvp/architecture.md): [backend](docs/mvp/architecture-backend.md), [front end](docs/mvp/architecture-frontend.md), [cli and skills](docs/mvp/architecture-cli.md), [scale concerns](docs/mvp/scale-concerns.md), and the [Rivet](docs/mvp/spike-rivet.md) and [Better Auth](docs/mvp/spike-better-auth.md) spikes
- [Implementation plan](docs/implementation-plan.md): where to start, and in what order

The prototypes are in `experiments/`.

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
```

You need [Bun](https://bun.sh), Node (for Storybook) and Docker (for the Rivet Engine and a local S3-compatible bucket).

```
bun install
bun run typecheck
bun test
```
