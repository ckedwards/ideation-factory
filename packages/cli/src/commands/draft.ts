// ideaf draft …: the idea's one draft, shared by everyone with edit access.
// People change it in the web app, and suggestions are accepted into it; here
// it's read, committed as one version, or discarded.
import { ApiError, type Operations, type Output } from '@ideaf/api'
import { parseMarkdown } from '@ideaf/core'
import { CliError, type Context, EXIT } from '../context.ts'
import { truncate } from './output.ts'
import { Names } from './subjects.ts'

type Change = Output<Operations['getDraft']>['changes'][number]['change']

export async function show(ctx: Context, flags: { idea?: string }): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  const draft = await ctx.api.getDraft({ idea })
  ctx.result({ idea, ...draft })
  if (draft.changes.length === 0) {
    ctx.say(`The draft of ${idea} is empty.`)
    return EXIT.ok
  }
  const names = new Names(ctx)
  const n = draft.changes.length
  ctx.say(`The draft of ${idea}, on v${draft.version}: ${n} change${n === 1 ? '' : 's'}`)
  for (const c of draft.changes) {
    const by = await names.label({ kind: 'user', id: c.by.user })
    ctx.say(`  ${c.key}  ${describe(c.change)} · ${by}${c.problem ? `\n        outdated: ${c.problem}` : ''}`)
  }
  const outdated = draft.changes.filter((c) => c.problem).length
  if (outdated > 0) {
    ctx.say(`\n${outdated} outdated: undo or redo ${outdated === 1 ? 'it' : 'them'} in the web app before committing.`)
  }
  return EXIT.ok
}

export async function commit(ctx: Context, flags: { idea?: string }): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  const done = await ctx.api.commitDraft({ idea })
  ctx.say(`Committed the draft as v${done.version}. Run \`ideaf pull\` to bring it into your files.`)
  ctx.result({ idea, ...done })
  return EXIT.ok
}

export async function discard(ctx: Context, flags: { idea?: string }): Promise<number> {
  const idea = await ctx.ideaId(flags.idea)
  await ctx.api.discardDraft({ idea })
  ctx.say(`Discarded the draft of ${idea}.`)
  ctx.result({ idea, discarded: true })
  return EXIT.ok
}

/**
 * Sends a write that makes a version. If the server says it would make
 * changes in the idea's draft outdated, a person at a terminal is shown them
 * and asked; otherwise it stops, saying to pass --outdate-draft. Null if they
 * said no: nothing changed.
 */
export async function confirmingDraft<T>(
  ctx: Context,
  confirmed: boolean,
  send: (outdateDraft: boolean) => Promise<T>,
): Promise<T | null> {
  try {
    return await send(confirmed)
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'draft_outdated')) {
      throw error
    }
    const changes =
      (error.details as { changes?: Array<{ key: string; change: Change; by: { user: string }; problem: string }> })
        ?.changes ?? []
    const names = new Names(ctx)
    const lines = await Promise.all(
      changes.map(
        async (c) => `  ${c.key}  ${describe(c.change)} · ${await names.label({ kind: 'user', id: c.by.user })}`,
      ),
    )
    const them = changes.length === 1 ? 'it' : 'them'
    if (!ctx.io.interactive || ctx.json) {
      throw new CliError(
        `${error.message}:\n${lines.join('\n')}\nPass --outdate-draft to go ahead, making ${them} outdated.`,
        EXIT.draftOutdated,
        'draft_outdated',
        error.details,
      )
    }
    ctx.say(
      `This would make ${changes.length === 1 ? 'a change' : `${changes.length} changes`} in the idea's draft outdated:`,
    )
    for (const line of lines) {
      ctx.say(line)
    }
    if (!(await ctx.io.confirm(`Go ahead, making ${them} outdated?`))) {
      ctx.say('Nothing changed.')
      return null
    }
    return send(true)
  }
}

function describe(change: Change): string {
  const text = (markdown: string) =>
    JSON.stringify(truncate(parseMarkdown(markdown).plain.text.replace(/\s+/g, ' ').trim() || markdown.trim(), 60))
  switch (change.kind) {
    case 'insert':
      return `added ${text(change.markdown)}`
    case 'suggestion':
      return `suggestion ${change.comment}: ${text(change.old)} → ${text(change.new)}`
    case 'delete':
      return `deleted ${text(change.was)}`
    case 'edit':
      return `edited ${change.id}: ${text(change.source)}`
  }
}
