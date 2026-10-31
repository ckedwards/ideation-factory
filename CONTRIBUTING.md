# Contributing

## Commit messages

Commits follow rules adapted from [Angular's commit message guidelines](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md). The `commit-msg` hook checks every commit (`bun install` turns it on), and CI checks every push and pull request, so a message that breaks them is caught either way. To check a message yourself: `bun scripts/commit-lint.ts --message "…"`.

```
<type>(<scope>): <summary>
                                      ← blank line
<body: why the change was made>
                                      ← blank line
<footers: BREAKING CHANGE, DEPRECATED, Fixes #123, Co-Authored-By, …>
```

### Type

| Type | For |
|---|---|
| `build` | The build system, dependencies and developer tooling (`build(dev-infra)` for `scripts/`, the worktree setup, hooks) |
| `ci` | CI configuration (`.github/`) |
| `docs` | Documentation only |
| `feat` | A new feature |
| `fix` | A bug fix |
| `perf` | A change that improves performance |
| `refactor` | A change that neither fixes a bug nor adds a feature |
| `test` | Adding or correcting tests, and test infrastructure |
| `revert` | Undoing an earlier commit |

There's no `chore`: pick the type that says what changed.

### Scope

The package the commit changes: `core`, `api`, `server`, `cli`, `ui`, `web` or `e2e`, or `dev-infra` for `scripts/` and other developer tooling. Leave the scope out when a change spans several packages, and for `docs` commits.

### Summary

- In the imperative: "add the directory", not "added" or "adds".
- Starting with a lowercase letter, with no full stop at the end.
- The whole first line within 100 characters.

### Body

Required for every type except `docs`, and at least 20 characters. Say why the change was made: the motivation, and how behavior differs from before.

### Breaking changes

A breaking change has **both**:
- a `!` before the colon in the title, so it's visible in `git log --oneline` and pull request titles: `feat(api)!: rename the batch scope field`;
- a `BREAKING CHANGE:` footer saying what breaks, then a blank line and how to migrate.

```
feat(api)!: rename the batch scope field

`in` reads badly in generated clients and clashes with a reserved word
in some languages.

BREAKING CHANGE: batch steps take `scope` instead of `in`.

Rename the field in saved batches and in any client that builds them.
```

Deprecations use a `DEPRECATED:` footer in the same way, with the recommended replacement.

### Reverts

The title is `revert:` followed by the reverted commit's title, and the body says `This reverts commit <sha>.` and why.

### Examples

```
feat(cli): add ideaf unlock

A lock from another machine (a repository on a shared disk) blocked for
ten minutes, with no way out but deleting the file.
```

```
build(dev-infra): give each worktree its own Rivet Engine

Two worktrees on one engine ran each other's actors with the wrong code.
```

```
docs: describe the access model
```
