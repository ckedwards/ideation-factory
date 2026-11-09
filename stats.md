# Ideation Factory: repository stats

Taken from `master` at `4becbc5`, on 2026-11-09. Line counts are non-blank lines in tracked files; `bun.lock` and generated files aren't counted.

## Code by package

| Package | Source lines | Test lines | Test files | Tests written |
|---|---:|---:|---:|---:|
| `server` | 13,238 | 3,971 | 25 | 154 |
| `web` | 6,674 | 436 | 6 | 26 |
| `cli` | 4,648 | 248 | 5 | 16 |
| `ui` | 4,091 | 162 | 3 | 14 |
| `core` | 2,579 | 1,120 | 9 | 81 |
| `api` | 2,072 | 219 | 1 | 13 |
| `e2e` | 197 | 1,444 | 9 | 54 |
| `scripts` | 584 | 163 | 2 | 19 |
| `deploy` | — | 9 | 1 | 1 |
| **Total** | **34,083** | **7,772** | **61** | **378** |

## Tests

- **448 run, 448 passed**, in about 20 s across 61 files (`bun run test`). There are more runs than tests written because some run once for each implementation they cover (the directory's contract tests, for one).
- 68 Storybook story files (3,643 lines).

## By file type

| Type | Files | Lines |
|---|---:|---:|
| TypeScript (`.ts`) | 224 | 37,646 |
| TSX (`.tsx`) | 196 | 20,051 |
| CSS | 71 | 8,643 |
| Markdown | 24 | 2,901 |
| YAML | 9 | 749 |
| Dockerfiles | 4 | 123 |
| Shell | 3 | 58 |
| SQL (frozen migrations) | 3 | 114 |

The Markdown includes 13 design docs in `docs/` (1,609 lines).

## API

- 31 operations, 25 of them also MCP tools.

## History

- 210 commits on `master`, from 2026-10-24 to 2026-11-09 (17 days).
- 31 pull requests merged; none open.
- Commits by type: 73 `feat`, 41 `docs`, 23 `test`, 20 `fix`, 15 `build`, 11 `ci`, 10 `refactor`, 6 `perf`, 3 `revert`. A handful from before the commit rules have other prefixes.
