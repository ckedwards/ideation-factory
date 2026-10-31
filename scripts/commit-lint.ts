#!/usr/bin/env bun
// Checks commit messages against the repository's rules (CONTRIBUTING.md),
// adapted from Angular's commit message guidelines. Run by the commit-msg git
// hook (installed by `bun install`) and by CI on every push and pull request.
//
//   bun scripts/commit-lint.ts --file <path>        a message file (the hook)
//   bun scripts/commit-lint.ts --range <from>..<to> every commit in a range (CI)
//   bun scripts/commit-lint.ts --message "<text>"   one message

export const TYPES = ['build', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'test', 'revert'] as const
export const SCOPES = ['core', 'api', 'server', 'cli', 'ui', 'web', 'e2e', 'dev-infra'] as const

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()]*)\))?(?<bang>!)?: (?<summary>.*)$/
const MAX_HEADER = 100
const MIN_BODY = 20
/** Common first words that aren't the imperative ("add", not "added" or "adds"). */
const NOT_IMPERATIVE =
  /^(added|adds|adding|fixed|fixes|fixing|changed|changes|changing|updated|updates|updating|removed|removes|removing|moved|moves|renamed|renames|implemented|implements|created|creates|improved|improves|refactored|refactors|replaced|replaces|deleted|deletes|made|makes)\b/i

export interface LintOptions {
  /** Allow `fixup!` and `squash!` commits (fine locally; they shouldn't land). */
  allowFixups?: boolean
}

/** The problems with a commit message; empty if it follows the rules. */
export function lintCommitMessage(raw: string, options: LintOptions = {}): string[] {
  const message = clean(raw)
  if (!message) return ['the message is empty']
  const [header = '', ...rest] = message.split('\n')
  // merges made by git, and autosquash commits while working, are left alone
  if (/^Merge (branch|pull request|remote-tracking branch|commit) /.test(header)) return []
  if (/^(fixup|squash|amend)! /.test(header)) return options.allowFixups ? [] : [`"${header}" is a fixup commit: squash it before it lands`]

  const problems: string[] = []
  const match = HEADER.exec(header)
  if (!match?.groups) {
    return [`the first line must be "<type>(<scope>): <summary>" or "<type>: <summary>" (types: ${TYPES.join(', ')}), not "${header}"`]
  }
  const { type, scope, bang, summary } = match.groups as { type: string; scope?: string; bang?: string; summary: string }
  if (!(TYPES as readonly string[]).includes(type)) {
    problems.push(`"${type}" isn't a commit type; use one of ${TYPES.join(', ')}${type === 'chore' ? ' (there is no "chore": tooling is build(dev-infra), CI is ci, tests are test)' : ''}`)
  }
  if (scope !== undefined) {
    if (type === 'docs') problems.push('docs commits have no scope: "docs: …"')
    else if (!(SCOPES as readonly string[]).includes(scope)) problems.push(`"${scope}" isn't a scope; use a package (${SCOPES.join(', ')}), or no scope for changes across packages`)
  }
  if (header.length > MAX_HEADER) problems.push(`the first line is ${header.length} characters; keep it to ${MAX_HEADER}`)
  if (!summary.trim()) problems.push('the summary is empty')
  if (/^[A-Z]/.test(summary) && !/^[A-Z]{2,}/.test(summary)) problems.push('start the summary with a lowercase letter')
  if (/\.$/.test(summary)) problems.push("don't end the summary with a full stop")
  if (NOT_IMPERATIVE.test(summary)) problems.push(`write the summary in the imperative ("add", not "added" or "adds"): "${summary.split(' ')[0]}"`)

  // body and footers
  if (rest.length > 0 && rest[0] !== '') problems.push('leave a blank line after the first line')
  const body = rest.join('\n').trim()
  const prose = body
    .split('\n')
    .filter((line) => !isTrailer(line))
    .join('\n')
    .trim()
  if (type !== 'docs' && prose.length < MIN_BODY) {
    problems.push(`${type} commits need a body (at least ${MIN_BODY} characters) saying why the change was made`)
  }

  // breaking changes: "!" in the title and a BREAKING CHANGE: footer, each requiring the other
  const breaking = /^BREAKING CHANGE: \S/m.test(body)
  if (/^BREAKING[ -]CHANGES?:/im.test(body) && !breaking) problems.push('write the breaking change footer exactly as "BREAKING CHANGE: <what breaks>"')
  if (bang && !breaking) problems.push('a breaking change ("!" in the title) needs a "BREAKING CHANGE: <what breaks, and how to migrate>" footer')
  if (breaking && !bang) problems.push(`a breaking change needs "!" in the title, so it's visible: "${type}${scope !== undefined ? `(${scope})` : ''}!: ${summary}"`)

  if (type === 'revert' && !/This reverts commit [0-9a-f]{7,40}/.test(body)) problems.push('a revert says which commit: "This reverts commit <sha>." and why')
  return problems
}

/** Drops git's comment lines (and everything after a --verbose scissors line) and trailing spaces. */
function clean(raw: string): string {
  const scissors = raw.indexOf('# ------------------------ >8 ------------------------')
  const text = scissors >= 0 ? raw.slice(0, scissors) : raw
  return text
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

function isTrailer(line: string): boolean {
  return /^(BREAKING CHANGE|DEPRECATED|[A-Z][A-Za-z-]+): /.test(line) || /^(Fixes|Closes|Refs) #\d+/.test(line)
}

function git(args: string[]): string {
  const run = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' })
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString().trim()}`)
  return run.stdout.toString()
}

if (import.meta.main) {
  const [flag, value] = process.argv.slice(2)
  const report = (label: string, problems: string[]) => {
    console.error(`✗ ${label}`)
    for (const p of problems) console.error(`    ${p}`)
  }
  let failed = 0
  if (flag === '--file' && value) {
    const problems = lintCommitMessage(await Bun.file(value).text(), { allowFixups: true })
    if (problems.length) {
      report('this commit message breaks the rules in CONTRIBUTING.md:', problems)
      console.error('\nYour message was kept in .git/COMMIT_EDITMSG; fix it and commit again.')
      failed = 1
    }
  } else if (flag === '--message' && value !== undefined) {
    const problems = lintCommitMessage(value)
    if (problems.length) {
      report('this message breaks the rules in CONTRIBUTING.md:', problems)
      failed = 1
    }
  } else if (flag === '--range' && value) {
    const shas = git(['rev-list', '--no-merges', '--reverse', value]).split('\n').filter(Boolean)
    for (const sha of shas) {
      const problems = lintCommitMessage(git(['log', '-1', '--format=%B', sha]))
      if (problems.length) {
        report(`${sha.slice(0, 7)} ${git(['log', '-1', '--format=%s', sha]).trim()}`, problems)
        failed++
      }
    }
    console.error(failed ? `\n${failed} of ${shas.length} commits break the rules in CONTRIBUTING.md.` : `All ${shas.length} commits follow the rules.`)
  } else {
    console.error('usage: bun scripts/commit-lint.ts --file <path> | --range <from>..<to> | --message "<text>"')
    process.exit(2)
  }
  process.exit(failed ? 1 : 0)
}
