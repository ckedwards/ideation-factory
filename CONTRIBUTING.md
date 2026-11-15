# Contributing

## Code style

[oxlint](https://oxc.rs/docs/guide/usage/linter) checks the rules (`.oxlintrc.json`) and [oxfmt](https://oxc.rs/docs/guide/usage/formatter) the layout (`.oxfmtrc.json`), for the TypeScript and JSON in `packages/` and `scripts/`. A pre-commit hook checks the staged files and CI checks everything; `bun run format` fixes what they report, and `bun run lint` checks without changing anything. Bun's own `bun lint` and `bun fmt` read these same config files, so moving to them later is a small change.

- **Every body of `if`, `else`, `for`, `while` and `do` is a block in braces, on its own lines**, even when it's one statement:

  ```ts
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) {
      url.searchParams.set(name, String(value))
    }
  }
  ```

- The formatter decides the rest of the layout: 2-space indents, single quotes, no semicolons, trailing commas, lines up to 120 characters.


## Secrets

No secrets go in the repository, and it's public. [Betterleaks](https://github.com/betterleaks/betterleaks) checks for them with its own rules (`scripts/secrets.sh`, which downloads one pinned release and checks it against its checksum before running it): the pre-commit hook over what's staged, and CI over every commit in the branch's history, a pull request's with its own exceptions. If it finds one, remove it, and if it was ever pushed, revoke it: the history keeps it. If what it found only looks like a secret (a test fixture, a placeholder), add an exception to `.betterleaks.toml`, limited to that rule and file, and say why.
## Workflows

Every action a workflow in `.github/workflows/` uses is pinned to a commit in `.github/workflows/actions.lock`, written by [gh actions-lock](https://github.com/github/gh-actions-lock) (`gh extension install github/gh-actions-lock`). When you add or change a workflow, or the version of an action it uses, run `gh actions-lock` and commit the lockfile with it. The pre-commit hook checks that every action has an entry, and CI checks that each pin is still the commit its tag pointed to.

## Releases

A release is made by hand, from the commit at `master`'s tip: Actions → Release → Run workflow, or `gh workflow run release.yml`. While in alpha it's always the next `v0.1.<n>`, the patch one higher than the last release. It releases the very builds that commit already published (its `sha-<commit>` images), adds the version and `latest` to them, and makes the GitHub release with the native builds for VMs and bare metal, which tags the commit. Don't push release tags yourself: nothing builds from them.

## Commit messages

Commits follow rules adapted from [Angular's commit message guidelines](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md). The `commit-msg` hook checks every commit (`bun install` turns it on), and CI checks every push and pull request, so a message that breaks them is caught either way. To check a message yourself: `bun scripts/commit-lint.ts --message "…"`.

Pull requests are merged by squashing or rebasing, never with a merge commit. A squash merge makes the pull request's title the first line of its commit, so the title follows the same rules as a commit's first line, with a `!` when any of its commits has a breaking change. CI's `title` job checks it, again whenever the title is edited; to check one before opening the pull request: `bun scripts/commit-lint.ts --title "…" master..HEAD`.

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

The package the commit changes: `core`, `api`, `server`, `cli`, `ui`, `web`, `e2e` or `load`, or `dev-infra` for `scripts/` and other developer tooling. Leave the scope out when a change spans several packages, and for `docs` commits.

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
