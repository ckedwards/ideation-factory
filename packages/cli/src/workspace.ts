// Where the cli works: the repository root (or the current folder outside
// git), the Markdown files in scope, and the per-idea state.
//
// State is one file per idea, in git's shared directory
// (`$(git rev-parse --git-common-dir)/ideaf/<idea>.json`), so every worktree
// sees it and it's never committed. Outside git it's `.ideaf/state/` in the
// root. Which idea a worktree is on is kept per worktree (in its own git dir).
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

export interface Workspace {
  root: string
  git: { commonDir: string; gitDir: string; branch: string | null } | null
  stateDir: string
  activeFile: string
}

export interface FileState {
  file: string
  /** Content hash of the version's file last uploaded or pulled here: the base for the next sync. */
  base: string
  /** The version that base came from. */
  version: number
  /**
   * The draft's text of the file, and its blocks, when it was pulled while the idea's draft had
   * changes: what's here is then edited from that, and syncing sends the difference into the draft.
   */
  draft?: DraftBase
}

/** A file as the idea's draft had it: its text, and each block's ID, text and kind. */
export interface DraftBase {
  content: string
  units: Array<{ id: string; source: string; kind: string }>
}

export interface IdeaState {
  idea: string
  server: string
  /** The latest version this working tree has synced or pulled. */
  version: number
  branch: string | null
  /** By path, relative to the root, with "/" separators. */
  files: Record<string, FileState>
}

function git(cwd: string, args: string[]): string | null {
  const run = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  return run.exitCode === 0 ? run.stdout.toString().trim() : null
}

export function openWorkspace(cwd: string): Workspace {
  const top = git(cwd, ['rev-parse', '--show-toplevel'])
  if (top) {
    const commonDir = resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir'])!)
    const gitDir = resolve(cwd, git(cwd, ['rev-parse', '--git-dir'])!)
    const branch = git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])
    return {
      root: top,
      git: { commonDir, gitDir, branch },
      stateDir: join(commonDir, 'ideaf'),
      activeFile: join(gitDir, 'ideaf-active'),
    }
  }
  return { root: cwd, git: null, stateDir: join(cwd, '.ideaf', 'state'), activeFile: join(cwd, '.ideaf', 'active') }
}

// --- branches and worktrees, for ideaf change -----------------------------------

/** The repository's worktrees and the branch each has checked out. */
export function worktrees(ws: Workspace): Array<{ path: string; branch: string | null }> {
  const out = git(ws.root, ['worktree', 'list', '--porcelain']) ?? ''
  const found: Array<{ path: string; branch: string | null }> = []
  for (const block of out.split('\n\n')) {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    if (path) {
      found.push({ path, branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null })
    }
  }
  return found
}

/** Whether a branch exists here, or only on a remote (git switch then creates it, tracking the remote). */
export function branchWhere(ws: Workspace, branch: string): 'local' | 'remote' | null {
  if (git(ws.root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]) !== null) {
    return 'local'
  }
  return git(ws.root, ['for-each-ref', '--format=%(refname)', `refs/remotes/*/${branch}`]) ? 'remote' : null
}

/**
 * A network remote as host and path, the way an idea's git hint names a
 * repository: https://github.com/acme/plans.git, git@github.com:acme/plans and
 * ssh://git@github.com:22/acme/plans are all github.com/acme/plans. Users,
 * passwords and ports are dropped. Null for a remote that only means
 * something on this machine: a path, or file://.
 */
export function repoUri(url: string): string | null {
  // scheme://[user@]host[:port]/path, for the schemes that reach another machine
  const full = /^(?:https?|ssh|git|git\+ssh|ssh\+git):\/\/(?:[^/@]*@)?([^/]+)\/(.+)$/i.exec(url)
  // [user@]host:path, git's scp-like form (ssh); not a path, and not another scheme
  const scp = /^(?:[^/@:]+@)?([^/:\\]{2,}):(?!\/\/)([^\\]+)$/.exec(url)
  const found = full ? [full[1]!.replace(/:\d+$/, ''), full[2]!] : scp ? [scp[1]!, scp[2]!] : null
  if (!found) {
    return null
  }
  const path = found[1]!
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  return path ? `${found[0]!.toLowerCase()}/${path}` : null
}

/** A remote's URL as configured: not rewritten by url.<base>.insteadOf, which is this machine's own setting. */
function remoteUrl(ws: Workspace, name: string): string | null {
  return git(ws.root, ['config', '--get', `remote.${name}.url`])
}

/** Where this working tree is in git, for the server: its branch, and the repository of that branch's remote (or origin). */
export function gitHint(ws: Workspace): { uri: string | null; branch: string } | undefined {
  const branch = ws.git?.branch
  if (!branch) {
    return undefined
  }
  const url = remoteUrl(ws, git(ws.root, ['config', `branch.${branch}.remote`]) ?? 'origin')
  return { uri: url ? repoUri(url) : null, branch }
}

/** The repository's remotes, by name. */
export function remotes(ws: Workspace): Array<{ name: string; url: string }> {
  return (git(ws.root, ['remote']) ?? '')
    .split('\n')
    .filter(Boolean)
    .flatMap((name) => {
      const url = remoteUrl(ws, name)
      return url ? [{ name, url }] : []
    })
}

const toPosix = (path: string) => path.split(sep).join('/')

/** The Markdown files under `scope` (relative to the root), as sorted root-relative paths. Git repositories respect .gitignore. */
export async function scanMarkdown(ws: Workspace, scope = ''): Promise<string[]> {
  const base = toPosix(scope)
    .replace(/^\.\/?/, '')
    .replace(/\/$/, '')
  let paths: string[]
  if (ws.git) {
    const listed = git(ws.root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']) ?? ''
    paths = listed.split('\0').filter((p) => p && /\.md$/i.test(p) && existsSync(join(ws.root, p)))
  } else {
    paths = []
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue
        }
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else if (/\.md$/i.test(entry.name)) {
          paths.push(toPosix(relative(ws.root, full)))
        }
      }
    }
    await walk(ws.root)
  }
  return [...new Set(paths)].filter((p) => !base || p === base || p.startsWith(`${base}/`)).toSorted()
}

/** A path given on the command line, relative to the root. */
export function scopeFrom(ws: Workspace, cwd: string, path: string | undefined): string {
  if (!path) {
    return toPosix(relative(ws.root, cwd))
  }
  const rel = toPosix(relative(ws.root, resolve(cwd, path)))
  if (rel.startsWith('..')) {
    throw new Error(`${path} is outside ${ws.root}`)
  }
  return rel
}

export async function readText(ws: Workspace, path: string): Promise<string | null> {
  try {
    return await readFile(join(ws.root, path), 'utf8')
  } catch {
    return null
  }
}

export async function writeText(ws: Workspace, path: string, content: string): Promise<void> {
  const full = join(ws.root, path)
  await mkdir(dirname(full), { recursive: true })
  const temporary = `${full}.ideaf-${crypto.randomUUID()}`
  await writeFile(temporary, content)
  await rename(temporary, full)
}

export async function removeFile(ws: Workspace, path: string): Promise<void> {
  await rm(join(ws.root, path), { force: true })
}

export async function readState(ws: Workspace, idea: string): Promise<IdeaState | null> {
  try {
    return JSON.parse(await readFile(join(ws.stateDir, `${idea}.json`), 'utf8')) as IdeaState
  } catch {
    return null
  }
}

/** Every idea with state here: the repository's (shared by its worktrees), or this folder's outside git. */
export async function listStates(ws: Workspace): Promise<IdeaState[]> {
  let names: string[]
  try {
    names = await readdir(ws.stateDir)
  } catch {
    return []
  }
  const states = await Promise.all(
    names.filter((n) => n.endsWith('.json')).map((n) => readState(ws, n.slice(0, -'.json'.length))),
  )
  return states.filter((s): s is IdeaState => s !== null).sort((a, b) => a.idea.localeCompare(b.idea))
}

export async function writeState(ws: Workspace, state: IdeaState): Promise<void> {
  await mkdir(ws.stateDir, { recursive: true })
  const file = join(ws.stateDir, `${state.idea}.json`)
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`)
  await rename(temporary, file)
}

export async function activeIdea(ws: Workspace): Promise<string | null> {
  try {
    return (await readFile(ws.activeFile, 'utf8')).trim() || null
  } catch {
    return null
  }
}

export async function setActiveIdea(ws: Workspace, idea: string): Promise<void> {
  await mkdir(dirname(ws.activeFile), { recursive: true })
  await writeFile(ws.activeFile, `${idea}\n`)
}

// --- one ideaf at a time per idea -----------------------------------------------

export type LockHolder = { pid: number; host: string; at: number }

export class IdeaBusy extends Error {
  constructor(readonly holder: LockHolder | null) {
    super(
      holder
        ? `another ideaf (pid ${holder.pid} on ${holder.host}) is working on this idea`
        : 'another ideaf is working on this idea',
    )
  }
}

/** A lock from another machine (a shared disk) counts as abandoned after this long. */
const STALE_MS = 10 * 60 * 1000

/**
 * Runs `fn` holding the idea's lock file (`<idea>.lock` next to its state), so
 * two ideaf processes can't sync or pull the same idea at once: each reads the
 * bases, talks to the server and writes the state as one unit. Waits up to
 * `waitMs` for another process to finish. A lock whose process is gone (same
 * machine) or that's older than 10 minutes (another machine) is taken over.
 */
export async function withIdeaLock<T>(ws: Workspace, idea: string, fn: () => Promise<T>, waitMs = 5000): Promise<T> {
  await mkdir(ws.stateDir, { recursive: true })
  const path = join(ws.stateDir, `${idea}.lock`)
  const me: LockHolder = { pid: process.pid, host: hostname(), at: Date.now() }
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      const handle = await open(path, 'wx')
      await handle.writeFile(JSON.stringify(me))
      await handle.close()
      break
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') {
        throw error
      }
      const holder = await readHolder(path)
      if (await abandoned(path, holder)) {
        await rm(path, { force: true })
        continue
      }
      if (Date.now() >= deadline) {
        throw new IdeaBusy(holder)
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  held.set(path, me)
  installSignalCleanup()
  try {
    return await fn()
  } finally {
    held.delete(path)
    releaseIfOurs(path, me)
  }
}

/** Removes a lock file only if it still belongs to `me` (someone may have unlocked and taken it since). */
function releaseIfOurs(path: string, me: LockHolder): void {
  try {
    const holder = JSON.parse(readFileSync(path, 'utf8')) as LockHolder
    if (holder.pid === me.pid && holder.host === me.host && holder.at === me.at) {
      rmSync(path, { force: true })
    }
  } catch {
    // already gone
  }
}

// Ctrl-C (or a kill) skips `finally`, so locks this process holds are released
// on the way out; otherwise the next command would have to notice they're stale.
const held = new Map<string, LockHolder>()
let cleanupInstalled = false

function installSignalCleanup(): void {
  if (cleanupInstalled) {
    return
  }
  cleanupInstalled = true
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ] as const) {
    process.on(signal, () => {
      for (const [path, me] of held) {
        releaseIfOurs(path, me)
      }
      process.exit(code)
    })
  }
}

/** Who holds an idea's lock, or null if nobody does. */
export async function lockHolder(
  ws: Workspace,
  idea: string,
): Promise<{ holder: LockHolder | null; running: boolean } | null> {
  const path = join(ws.stateDir, `${idea}.lock`)
  if (!existsSync(path)) {
    return null
  }
  const holder = await readHolder(path)
  return { holder, running: !(await abandoned(path, holder)) && holder?.host === hostname() }
}

export async function removeLock(ws: Workspace, idea: string): Promise<void> {
  await rm(join(ws.stateDir, `${idea}.lock`), { force: true })
}

async function readHolder(path: string): Promise<LockHolder | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as LockHolder
  } catch {
    return null
  }
}

async function abandoned(path: string, holder: LockHolder | null): Promise<boolean> {
  if (holder && holder.host === hostname()) {
    try {
      process.kill(holder.pid, 0)
      return false
    } catch (error) {
      // EPERM means the process exists but isn't ours
      return (error as { code?: string }).code === 'ESRCH'
    }
  }
  // another machine, or a lock still being written: go by age
  try {
    return Date.now() - (await stat(path)).mtimeMs > STALE_MS
  } catch {
    return false
  }
}
