// ideaf sync: upload the Markdown that changed since it was last synced or
// pulled, each with its base, so the server can follow comments and refuse
// with "pull first" if the idea moved on.
import { contentHash } from '@ideaf/core'
import type { Context } from '../context.ts'
import { EXIT } from '../context.ts'
import { gitHint, type IdeaState, readText, scanMarkdown, scopeFrom, writeState } from '../workspace.ts'
import { describeOutcomes } from './output.ts'

export function sync(
  ctx: Context,
  flags: { idea?: string; force?: boolean },
  path: string | undefined,
): Promise<number> {
  return ctx.locked(flags.idea, ({ id, state }) => run(ctx, id, state, flags, path))
}

async function run(
  ctx: Context,
  id: string,
  state: IdeaState,
  flags: { force?: boolean },
  path: string | undefined,
): Promise<number> {
  const scope = scopeFrom(ctx.ws, ctx.io.cwd, path)
  const inScope = (p: string) => !scope || p === scope || p.startsWith(`${scope}/`)
  const local = new Map<string, { content: string; hash: string }>()
  for (const p of await scanMarkdown(ctx.ws, scope)) {
    const content = (await readText(ctx.ws, p))!
    local.set(p, { content, hash: await contentHash(content) })
  }

  const files: Array<{ file?: string; path: string; content: string; base?: string }> = []
  const gone = Object.entries(state.files).filter(([p]) => inScope(p) && !local.has(p))
  const renamedFrom = new Set<string>()
  for (const [p, { content, hash }] of local) {
    const tracked = state.files[p]
    if (tracked) {
      if (hash !== tracked.base) {
        files.push({ file: tracked.file, path: p, content, base: tracked.base })
      }
      continue
    }
    // a file that disappeared with exactly this content was moved here: send it as a rename
    const moved = gone.find(([old, f]) => f.base === hash && !renamedFrom.has(old))
    if (moved) {
      renamedFrom.add(moved[0])
      files.push({ file: moved[1].file, path: p, content, base: moved[1].base })
    } else {
      files.push({ path: p, content })
    }
  }
  const deleted = gone.filter(([p]) => !renamedFrom.has(p)).map(([, f]) => f.file)

  if (files.length === 0 && deleted.length === 0) {
    ctx.say('Nothing to sync.')
    ctx.result({ idea: id, version: state.version, uploaded: [], deleted: [] })
    return EXIT.ok
  }

  const hint = gitHint(ctx.ws)
  const result = await ctx.api.sync({
    idea: id,
    files,
    ...(deleted.length ? { deleted } : {}),
    ...(flags.force ? { force: true } : {}),
    // the server remembers where it was last synced from, for other machines
    ...(hint ? { gitHint: hint } : {}),
  })
  const pulled = await ctx.api.pull({ idea: id, version: result.version })
  const hashes = new Map([...local].map(([p, f]) => [p, f.hash]))
  const next = { ...state, version: result.version, branch: hint?.branch ?? state.branch, files: { ...state.files } }
  for (const p of Object.keys(next.files)) {
    if (inScope(p) && !local.has(p)) {
      delete next.files[p]
    }
  }
  for (const f of pulled.files) {
    if (hashes.get(f.path) === f.hash) {
      next.files[f.path] = { file: f.file, base: f.hash, version: result.version }
    }
  }
  await writeState(ctx.ws, next)

  ctx.say(
    `Synced ${files.length} file${files.length === 1 ? '' : 's'}${deleted.length ? ` and deleted ${deleted.length}` : ''} as v${result.version}.`,
  )
  for (const line of describeOutcomes(result.comments)) {
    ctx.say(line)
  }
  ctx.result({ idea: id, ...result, uploaded: files.map((f) => f.path), deleted })
  return EXIT.ok
}
