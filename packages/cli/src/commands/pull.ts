// ideaf pull: bring the idea's latest version into your files, or, while the
// idea's draft has changes, the draft (what everyone's editing on it), so that
// what you then edit and sync goes into the draft on top of theirs. A file you
// haven't changed is replaced; one you have is merged (3-way, from what you last
// pulled or synced), with conflicts left in the file like git. Works on a new
// machine too: with no local state, it writes the files and starts tracking them.
import { contentHash } from '@ideaf/core'
import { CliError, type Context, EXIT } from '../context.ts'
import { mergeFile } from '../merge.ts'
import {
  activeIdea,
  type IdeaState,
  readState,
  readText,
  removeFile,
  setActiveIdea,
  writeState,
  writeText,
} from '../workspace.ts'

type Change = {
  path: string
  change: 'written' | 'merged' | 'conflict' | 'moved' | 'deleted' | 'kept' | 'unchanged'
  from?: string
}

export async function pull(ctx: Context, flags: { idea?: string }): Promise<number> {
  const id = flags.idea ?? (await activeIdea(ctx.ws))
  if (!id) {
    throw new CliError(
      'no idea here yet: run `ideaf start`, or `ideaf pull --idea <id>` to start tracking one',
      EXIT.usage,
      'no_idea',
    )
  }
  return ctx.lock(id, async () => {
    const pulled = await pullInto(ctx, id)
    ctx.result({ idea: id, version: pulled.version, changes: pulled.changes })
    return pulled.exit
  })
}

/**
 * Says you've opened a version (for reviewers' "seen v3"). It's not what the
 * command is for, so its failing never fails the command.
 */
export async function markSeen(ctx: Context, idea: string, version: number): Promise<void> {
  try {
    await ctx.api.markSeen({ idea, version })
  } catch {
    // not kept this time: the next show or pull says it again
  }
}

/** Pulls an idea into the working tree (the caller holds its lock), printing what changed for people. */
export async function pullInto(
  ctx: Context,
  id: string,
): Promise<{ version: number; changes: Change[]; exit: number }> {
  const state: IdeaState = (await readState(ctx.ws, id)) ?? {
    idea: id,
    server: ctx.server,
    version: 0,
    branch: ctx.ws.git?.branch ?? null,
    files: {},
  }
  const latest = await ctx.api.pull({ idea: id })
  // the draft, if it has changes and you can edit: what's pulled instead of the version
  const draft = await ctx.api.getDraft({ idea: id }).catch(() => null)
  const drafting = draft !== null && draft.changes.length > 0 && draft.version === latest.version ? draft : null
  const baseVersions = new Map<number, Map<string, string>>()
  const baseContent = async (version: number, file: string) => {
    if (!baseVersions.has(version)) {
      baseVersions.set(
        version,
        new Map((await ctx.api.pull({ idea: id, version })).files.map((f) => [f.file, f.content])),
      )
    }
    return baseVersions.get(version)!.get(file) ?? ''
  }

  const byFile = new Map(Object.entries(state.files).map(([path, f]) => [f.file, { path, ...f }]))
  const changes: Change[] = []
  const files: IdeaState['files'] = {}

  // the files as they're to be here: the draft's (new ones too, renamed where it renames them, and
  // without those it deletes) while it has changes, else the version's
  const versionHash = new Map(latest.files.map((f) => [f.file, f.hash]))
  const remotes = drafting
    ? await Promise.all(
        drafting.files.map(async (d) => ({
          file: d.file,
          path: d.path,
          content: d.content,
          hash: await contentHash(d.content),
          base: versionHash.get(d.file) ?? '',
          drafted: d,
        })),
      )
    : latest.files.map((v) => ({ ...v, base: v.hash, drafted: null }))
  for (const remote of remotes) {
    const { drafted } = remote
    const tracked = byFile.get(remote.file)
    byFile.delete(remote.file)
    const oldPath = tracked?.path ?? remote.path
    const local = await readText(ctx.ws, oldPath)
    const localHash = local === null ? null : await contentHash(local)
    // what's here was edited from: the draft's text, if it was pulled from the draft, else the version's
    const trackedHash = tracked?.draft ? await contentHash(tracked.draft.content) : tracked?.base
    files[remote.path] = {
      file: remote.file,
      // a file new in the draft has no version to be based on
      base: remote.base,
      version: latest.version,
      ...(drafted
        ? {
            draft: {
              content: drafted.content,
              units: drafted.units.map((u) => ({ id: u.id, source: u.source, kind: u.kind })),
            },
          }
        : {}),
    }

    let content: string
    let change: Change['change']
    if (local === null) {
      ;[content, change] = [remote.content, 'written']
    } else if (localHash === remote.hash) {
      ;[content, change] = [local, 'unchanged']
    } else if (tracked && localHash === trackedHash) {
      ;[content, change] = [remote.content, 'written']
    } else if (tracked && remote.hash === trackedHash) {
      ;[content, change] = [local, 'kept']
    } else {
      const base = tracked ? (tracked.draft?.content ?? (await baseContent(tracked.version, remote.file))) : ''
      const merged = mergeFile(local, base, remote.content, drafted ? `the draft` : `v${latest.version}`)
      ;[content, change] = [merged.content, merged.conflict ? 'conflict' : 'merged']
      // keep tracking your edits: the base is the server's version you merged with
    }
    if (oldPath !== remote.path) {
      await removeFile(ctx.ws, oldPath)
      changes.push({ path: remote.path, change: 'moved', from: oldPath })
    }
    if (change !== 'unchanged' || oldPath !== remote.path) {
      await writeText(ctx.ws, remote.path, content)
    }
    if (change !== 'unchanged') {
      changes.push({ path: remote.path, change })
    }
  }

  // files deleted on the server, or in the draft
  for (const gone of byFile.values()) {
    const local = await readText(ctx.ws, gone.path)
    const pulledHash = gone.draft ? await contentHash(gone.draft.content) : gone.base
    if (local !== null && (await contentHash(local)) !== pulledHash) {
      changes.push({ path: gone.path, change: 'kept' })
      const where = drafting ? 'in the draft' : `in v${latest.version}`
      ctx.say(`  ${gone.path} was deleted ${where}; your edited copy is kept, untracked`)
      continue
    }
    await removeFile(ctx.ws, gone.path)
    changes.push({ path: gone.path, change: 'deleted' })
  }

  await writeState(ctx.ws, { ...state, version: latest.version, files })
  await markSeen(ctx, id, latest.version)
  if (!(await activeIdea(ctx.ws))) {
    await setActiveIdea(ctx.ws, id)
  }

  const conflicts = changes.filter((c) => c.change === 'conflict')
  const what = drafting ? `the draft (on v${latest.version})` : `v${latest.version}`
  if (changes.length === 0) {
    ctx.say(`Already up to date with ${what}.`)
  } else {
    ctx.say(`Pulled ${what}:`)
    for (const c of changes) {
      ctx.say(`  ${c.change.padEnd(9)} ${c.from ? `${c.from} → ` : ''}${c.path}`)
    }
  }
  if (conflicts.length) {
    ctx.say(`Resolve the conflict markers in ${conflicts.map((c) => c.path).join(', ')}, then run \`ideaf sync\`.`)
  }
  return { version: latest.version, changes, exit: conflicts.length ? EXIT.mergeConflicts : EXIT.ok }
}
