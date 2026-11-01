// ideaf start: start an idea from Markdown files, and make it this working
// tree's idea. --branch first makes a branch for it off the default branch;
// --worktree puts that branch in a new worktree. Either way the files come
// along, as they are now.
import { resolve } from 'node:path'
import { contentHash } from '@ideaf/core'
import { CliError, type Context, EXIT } from '../context.ts'
import {
  addWorktree,
  branchWhere,
  createBranch,
  defaultBranch,
  openWorkspace,
  readText,
  scanMarkdown,
  scopeFrom,
  setActiveIdea,
  type Workspace,
  writeState,
  writeText,
} from '../workspace.ts'

export async function start(
  ctx: Context,
  flags: { title?: string; description?: string; team?: string; branch?: string; worktree?: string },
  path: string | undefined,
): Promise<number> {
  if (flags.worktree !== undefined && flags.branch === undefined) {
    throw new CliError('--worktree needs --branch: the new branch to check out there', EXIT.usage, 'usage')
  }
  if (flags.branch !== undefined && !ctx.ws.git) {
    throw new CliError('--branch and --worktree need a git repository', EXIT.usage, 'usage')
  }
  const scope = scopeFrom(ctx.ws, ctx.io.cwd, path)
  const paths = await scanMarkdown(ctx.ws, scope)
  if (paths.length === 0) {
    throw new CliError(`no Markdown files in ${scope || 'this folder'}`, EXIT.usage, 'no_files')
  }

  let title = flags.title?.trim()
  if (!title && ctx.io.interactive && !ctx.json) {
    title = ctx.io.prompt('Title:')?.trim()
  }
  if (!title) {
    throw new CliError('an idea needs a title: pass --title "…"', EXIT.usage, 'no_title')
  }

  const files = await Promise.all(paths.map(async (p) => ({ path: p, content: (await readText(ctx.ws, p))! })))
  const ws = flags.branch === undefined ? ctx.ws : await branchFor(ctx, flags.branch, flags.worktree, files)
  const created = await ctx.api.createIdea({
    title,
    ...(flags.description ? { description: flags.description } : {}),
    ...(flags.team ? { team: flags.team } : {}),
    files,
  })
  const pulled = await ctx.api.pull({ idea: created.idea, version: created.version })

  const local = new Map(await Promise.all(files.map(async (f) => [f.path, await contentHash(f.content)] as const)))
  await writeState(ws, {
    idea: created.idea,
    server: ctx.server,
    version: created.version,
    branch: ws.git?.branch ?? null,
    files: Object.fromEntries(
      pulled.files
        .filter((f) => local.get(f.path) === f.hash)
        .map((f) => [f.path, { file: f.file, base: f.hash, version: created.version }]),
    ),
  })
  await setActiveIdea(ws, created.idea)

  ctx.say(
    `Started "${title}" (${created.idea}), v${created.version} with ${paths.length} file${paths.length === 1 ? '' : 's'}:`,
  )
  for (const f of pulled.files) {
    ctx.say(`  ${f.file}  ${f.path}`)
  }
  if (flags.worktree !== undefined) {
    ctx.say(`It's on branch ${flags.branch}, in the new worktree ${ws.root}: work on it there (cd ${ws.root}).`)
  } else if (flags.branch !== undefined) {
    ctx.say(`It's on the new branch ${flags.branch}.`)
  }
  ctx.result({
    idea: created.idea,
    version: created.version,
    branch: ws.git?.branch ?? null,
    ...(flags.worktree !== undefined ? { worktree: ws.root } : {}),
    files: pulled.files.map((f) => ({ file: f.file, path: f.path })),
  })
  return EXIT.ok
}

/** Makes the idea's branch (and worktree), and returns the workspace the idea is now on. */
async function branchFor(
  ctx: Context,
  branch: string,
  worktree: string | undefined,
  files: Array<{ path: string; content: string }>,
): Promise<Workspace> {
  if (branchWhere(ctx.ws, branch)) {
    throw new CliError(`there's already a branch called ${branch}: pick another name`, EXIT.usage, 'branch_exists')
  }
  const base = defaultBranch(ctx.ws)
  if (!base) {
    throw new CliError(
      'no default branch to start from (no main, master or origin/HEAD): commit something first',
      EXIT.usage,
      'no_base',
    )
  }
  let there: Workspace
  if (worktree === undefined) {
    const made = createBranch(ctx.ws, branch, base)
    if (!made.ok) {
      throw new CliError(`couldn't make branch ${branch} from ${base}: ${made.error}`, EXIT.error, 'git')
    }
    there = openWorkspace(ctx.ws.root)
  } else {
    const where = resolve(ctx.io.cwd, worktree)
    const made = addWorktree(ctx.ws, where, branch, base)
    if (!made.ok) {
      throw new CliError(`couldn't make a worktree at ${where}: ${made.error}`, EXIT.error, 'git')
    }
    there = openWorkspace(where)
  }
  // the files come along: uncommitted edits do anyway, but files committed only
  // on the old branch would be missing, and the next sync would delete them
  for (const f of files) {
    if ((await readText(there, f.path)) !== f.content) {
      await writeText(there, f.path, f.content)
    }
  }
  return there
}
