// ideaf draft …: the idea's one draft, shared by everyone with edit access.
// People change it in the web app, and suggestions are accepted into it; here
// it's read, committed as one version, or discarded.
import type { Operations, Output } from '@ideaf/api'
import { parseMarkdown } from '@ideaf/core'
import { type Context, EXIT } from '../context.ts'
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
