#!/usr/bin/env bun
// Whether a change needs CI's story tests (the storybook job). They depend on
// the ui package, on core (whose Markdown the stories render), on the
// dependencies both resolve to, on the shared TypeScript settings and on the
// CI workflow. A change to anything else, a server dependency in bun.lock
// included, skips them.
//
//   bun scripts/ci-changes.ts <base> <head>   prints ui=true or ui=false
//
// <base>...<head> is compared as git diff does with three dots: what the
// branch changed since it left <base>, not what <base> gained since.

/** Files that change what the stories are, or how they run, whatever they contain. */
const UI_FILES = /^(packages\/(ui|core)\/|package\.json$|tsconfig\.base\.json$|\.github\/workflows\/ci\.yml$)/
/** The workspaces the stories build from. */
const UI_WORKSPACES = ['packages/ui', 'packages/core']

type Deps = Record<string, string>
type Workspace = {
  name: string
  dependencies?: Deps
  devDependencies?: Deps
  peerDependencies?: Deps
  optionalDependencies?: Deps
}
type PackageEntry = [string, ...unknown[]]
type Lock = { workspaces: Record<string, Workspace>; packages: Record<string, PackageEntry> }

const depNames = (deps: {
  dependencies?: Deps
  devDependencies?: Deps
  peerDependencies?: Deps
  optionalDependencies?: Deps
}) => [
  ...Object.keys(deps.dependencies ?? {}),
  ...Object.keys(deps.devDependencies ?? {}),
  ...Object.keys(deps.peerDependencies ?? {}),
  ...Object.keys(deps.optionalDependencies ?? {}),
]

/** A package key's path of package names: "rivetkit/@scope/x/zod" → ["rivetkit", "@scope/x", "zod"]. */
function namesIn(key: string): string[] {
  const parts = key.split('/')
  const names: string[] = []
  for (let i = 0; i < parts.length; i++) {
    names.push(parts[i]!.startsWith('@') ? `${parts[i]}/${parts[++i]}` : parts[i]!)
  }
  return names
}

/**
 * Every package (name@version) the ui and core workspaces resolve to, from a
 * bun.lock's text: their dependencies of every kind, and theirs in turn, found
 * the way Bun resolves them (nested under the package that needs them first,
 * then further up, then at the top).
 */
export function uiDependencies(lockText: string): Set<string> {
  const lock = Bun.JSONC.parse(lockText) as Lock
  const found = new Set<string>()
  const seen = new Set<string>()
  const visit = (key: string) => {
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    const entry = lock.packages[key]
    if (!entry) {
      return
    }
    found.add(entry[0])
    const workspace = entry[0].match(/@workspace:(.+)$/)?.[1]
    const meta = (
      workspace ? lock.workspaces[workspace] : entry.find((e, i) => i > 0 && e && typeof e === 'object')
    ) as Workspace | undefined
    for (const dep of depNames(meta ?? {})) {
      resolve(key, dep)
    }
  }
  const resolve = (from: string, dep: string) => {
    const path = namesIn(from)
    for (let i = path.length; i >= 1; i--) {
      const key = `${path.slice(0, i).join('/')}/${dep}`
      if (lock.packages[key]) {
        return visit(key)
      }
    }
    visit(dep)
  }
  for (const path of UI_WORKSPACES) {
    const workspace = lock.workspaces[path]
    if (!workspace) {
      continue
    }
    found.add(`${workspace.name}@workspace:${path}`)
    for (const dep of depNames(workspace)) {
      // a workspace's own dependencies are nested under its name, or at the top
      resolve(workspace.name, dep)
    }
  }
  return found
}

/** Whether these changes need the story tests; the lockfiles before and after, if bun.lock changed. */
export function needsStories(changed: readonly string[], lock?: { before: string; after: string }): boolean {
  if (changed.some((file) => UI_FILES.test(file))) {
    return true
  }
  if (!changed.includes('bun.lock') || !lock) {
    return false
  }
  const before = uiDependencies(lock.before)
  const after = uiDependencies(lock.after)
  return before.size !== after.size || [...after].some((p) => !before.has(p))
}

function git(args: string[]): string {
  const run = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' })
  if (run.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')}: ${run.stderr.toString().trim()}`)
  }
  return run.stdout.toString()
}

if (import.meta.main) {
  const [base, head] = process.argv.slice(2)
  if (!base || !head) {
    console.error('usage: bun scripts/ci-changes.ts <base> <head>')
    process.exit(2)
  }
  const from = git(['merge-base', base, head]).trim()
  const changed = git(['diff', '--name-only', `${from}...${head}`])
    .split('\n')
    .filter(Boolean)
  const lock = changed.includes('bun.lock')
    ? { before: git(['show', `${from}:bun.lock`]), after: git(['show', `${head}:bun.lock`]) }
    : undefined
  console.log(`ui=${needsStories(changed, lock)}`)
}
