// ideaf sync: upload the Markdown that changed since it was last synced or
// pulled, each with its base, so the server can follow comments and refuse
// with "pull first" if the idea moved on.
//
// While the idea's draft has changes (people editing it), what you changed
// goes into the draft instead, on top of theirs: the difference between the
// draft as you pulled it and your files, block by block, each block saying
// how it read when you pulled. If someone changed the same block since, it's
// refused: pull (which merges the draft into your files, conflicts marked) and
// sync again. --overwrite-draft makes a version over the draft instead, as a
// force push: everyone in the draft loses those changes, and is told.
import { ApiError } from '@ideaf/api'
import { blocksOfSource, contentHash, draftChanges, type Idea } from '@ideaf/core'
import { CliError, type Context } from '../context.ts'
import { EXIT } from '../context.ts'
import { gitHint, type IdeaState, readText, scanMarkdown, scopeFrom, writeState } from '../workspace.ts'
import { confirmingDraft } from './draft.ts'
import { describeOutcomes } from './output.ts'
import { pullInto } from './pull.ts'

export function sync(
  ctx: Context,
  flags: { idea?: string; force?: boolean; overwriteDraft?: boolean },
  path: string | undefined,
): Promise<number> {
  return ctx.locked(flags.idea, ({ id, state }) => run(ctx, id, state, flags, path))
}

async function run(
  ctx: Context,
  id: string,
  state: IdeaState,
  flags: { force?: boolean; overwriteDraft?: boolean },
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
      // changed since it was pulled: from the draft's text, if it came from the draft
      if (hash !== (tracked.draft ? await contentHash(tracked.draft.content) : tracked.base)) {
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

  // the draft has changes: yours go into it, on top of everyone's, unless you're overwriting it
  if (!flags.overwriteDraft) {
    const draft = await ctx.api.getDraft({ idea: id }).catch(() => null)
    if (draft && draft.changes.length > 0) {
      return intoDraft(ctx, id, state, files, deleted)
    }
  }

  const hint = gitHint(ctx.ws)
  const result = await confirmingDraft(ctx, flags.overwriteDraft === true, (overwriteDraft) =>
    ctx.api.sync({
      idea: id,
      files,
      ...(deleted.length ? { deleted } : {}),
      ...(flags.force ? { force: true } : {}),
      // the server remembers where it was last synced from, for other machines
      ...(hint ? { gitHint: hint } : {}),
      ...(overwriteDraft ? { overwriteDraft } : {}),
    }),
  )
  if (!result) {
    return EXIT.ok
  }
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

/**
 * Sends what changed here into the idea's draft: the difference between the draft as it was pulled
 * and these files, as the draft's own changes, each block saying how it read then. Then pulls the
 * draft back, now with these changes and anyone else's, so what's edited next goes on top of it.
 */
async function intoDraft(
  ctx: Context,
  id: string,
  state: IdeaState,
  files: Array<{ file?: string; path: string; content: string }>,
  deleted: string[],
): Promise<number> {
  const moved = files.filter((f) => !f.file || state.files[f.path]?.file !== f.file)
  if (moved.length > 0 || deleted.length > 0) {
    throw new CliError(
      "the idea's draft has changes, and a draft can't add, remove or rename files yet: commit or discard the draft first, or pass --overwrite-draft to make a version over it",
      EXIT.usage,
      'draft_files',
    )
  }
  if (files.some((f) => !state.files[f.path]!.draft)) {
    throw new CliError(
      "the idea's draft has changes your files don't have: run `ideaf pull` to bring them in (merging your edits), then sync again",
      EXIT.pullFirst,
      'pull_first',
    )
  }
  // the draft as it was pulled, and these files' blocks known as its blocks where they can be told
  const pulled = Object.entries(state.files).flatMap(([path, f]) => (f.draft ? [{ path, ...f, draft: f.draft }] : []))
  const numbers = pulled.flatMap((f) => [f.file, ...f.draft.units.map((u) => u.id)]).map((i) => Number(i.slice(1)))
  const base: Idea = {
    files: pulled.map((f) => ({
      id: f.file,
      path: f.path,
      source: f.draft.content,
      unitIds: f.draft.units.map((u) => u.id),
    })),
    nextId: 1 + Math.max(0, ...numbers.filter(Number.isFinite)),
  }
  const blocks = Object.fromEntries(
    files.map((f) => {
      const was = state.files[f.path]!.draft!.units as Parameters<typeof blocksOfSource>[0]
      return [state.files[f.path]!.file, blocksOfSource(was, f.content)]
    }),
  )
  const made = draftChanges(base, blocks)
  if (!made.ok) {
    throw new CliError(
      `your changes don't apply to the draft as you pulled it: ${made.message}`,
      EXIT.conflict,
      'conflict',
    )
  }
  if (made.changes.length === 0) {
    ctx.say('Nothing to sync.')
    ctx.result({ idea: id, draft: true, changes: [] })
    return EXIT.ok
  }
  try {
    await ctx.api.changeDraft({ idea: id, changes: made.changes })
  } catch (error) {
    if (error instanceof ApiError && error.code === 'conflict') {
      throw new CliError(
        'someone changed some of the same text in the draft since you pulled: run `ideaf pull` to merge it into your files (conflicts marked), then sync again',
        EXIT.pullFirst,
        'pull_first',
        error.details,
      )
    }
    throw error
  }
  const n = made.changes.length
  ctx.say(`Sent ${n} change${n === 1 ? '' : 's'} to the draft, on top of everyone's.`)
  const back = await pullInto(ctx, id)
  ctx.say('Commit the draft in the web app, or with `ideaf draft commit`.')
  ctx.result({ idea: id, draft: true, changes: made.changes, pulled: back.changes })
  return back.exit
}
