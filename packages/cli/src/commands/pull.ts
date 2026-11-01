// ideaf pull: bring the idea's latest version into your files. A file you
// haven't changed is replaced; one you have is merged (3-way, from its base),
// with conflicts left in the file like git. Works on a new machine too: with no
// local state, it writes the files and starts tracking them.
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

  for (const remote of latest.files) {
    const tracked = byFile.get(remote.file)
    byFile.delete(remote.file)
    const oldPath = tracked?.path ?? remote.path
    const local = await readText(ctx.ws, oldPath)
    const localHash = local === null ? null : await contentHash(local)
    files[remote.path] = { file: remote.file, base: remote.hash, version: latest.version }

    let content: string
    let change: Change['change']
    if (local === null) {
      ;[content, change] = [remote.content, 'written']
    } else if (localHash === remote.hash) {
      ;[content, change] = [local, 'unchanged']
    } else if (tracked && localHash === tracked.base) {
      ;[content, change] = [remote.content, 'written']
    } else if (tracked && remote.hash === tracked.base) {
      ;[content, change] = [local, 'kept']
    } else {
      const base = tracked ? await baseContent(tracked.version, remote.file) : ''
      const merged = mergeFile(local, base, remote.content, `v${latest.version}`)
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

  // files deleted on the server
  for (const gone of byFile.values()) {
    const local = await readText(ctx.ws, gone.path)
    if (local !== null && (await contentHash(local)) !== gone.base) {
      changes.push({ path: gone.path, change: 'kept' })
      ctx.say(`  ${gone.path} was deleted in v${latest.version}; your edited copy is kept, untracked`)
      continue
    }
    await removeFile(ctx.ws, gone.path)
    changes.push({ path: gone.path, change: 'deleted' })
  }

  await writeState(ctx.ws, { ...state, version: latest.version, files })
  if (!(await activeIdea(ctx.ws))) {
    await setActiveIdea(ctx.ws, id)
  }

  const conflicts = changes.filter((c) => c.change === 'conflict')
  if (changes.length === 0) {
    ctx.say(`Already up to date with v${latest.version}.`)
  } else {
    ctx.say(`Pulled v${latest.version}:`)
    for (const c of changes) {
      ctx.say(`  ${c.change.padEnd(9)} ${c.from ? `${c.from} → ` : ''}${c.path}`)
    }
  }
  if (conflicts.length) {
    ctx.say(`Resolve the conflict markers in ${conflicts.map((c) => c.path).join(', ')}, then run \`ideaf sync\`.`)
  }
  return { version: latest.version, changes, exit: conflicts.length ? EXIT.mergeConflicts : EXIT.ok }
}
