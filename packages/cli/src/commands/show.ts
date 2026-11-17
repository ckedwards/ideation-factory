// ideaf show --blocks: the structured view an agent reads before building a
// batch: each file's sections and blocks with their IDs, and the open comments.
import { CliError, type Context, EXIT } from '../context.ts'
import { truncate } from './output.ts'
import { markSeen } from './pull.ts'

export async function show(
  ctx: Context,
  flags: { idea?: string; blocks?: boolean; version?: string },
): Promise<number> {
  if (!flags.blocks) {
    throw new CliError('use `ideaf show --blocks` (the only view so far)', EXIT.usage, 'usage')
  }
  const { id } = await ctx.idea(flags.idea)
  const version = flags.version ? Number(flags.version) : undefined
  const view = await ctx.api.showBlocks({ idea: id, ...(version ? { version } : {}) })
  ctx.result(view)
  await markSeen(ctx, id, view.version)
  if (ctx.json) {
    return EXIT.ok
  }

  ctx.say(`${id} v${view.version}`)
  const onIdea = view.comments.filter((c) => c.anchor?.kind === 'idea')
  if (onIdea.length) {
    ctx.say('\ncomments on the idea:')
  }
  for (const c of onIdea) {
    ctx.say(`  ${c.id.padEnd(4)} ${truncate(c.body, 90)}${replies(c.replies.length)}`)
  }
  for (const file of view.files) {
    ctx.say(`\n${file.id}  ${file.path}`)
    for (const entry of file.entries) {
      const depth = Math.max(0, entry.path.length - (entry.kind === 'heading' ? 1 : 0))
      ctx.say(`  ${entry.id.padEnd(5)} ${'  '.repeat(depth)}${truncate(entry.source, 100 - depth * 2)}`)
    }
    const comments = view.comments.filter((c) => c.anchor && 'file' in c.anchor && c.anchor.file === file.id)
    if (comments.length) {
      ctx.say('  comments:')
    }
    for (const c of comments) {
      const on =
        c.anchor?.kind === 'text'
          ? `on "${truncate(c.anchor.quote, 40)}"`
          : c.anchor?.kind === 'section'
            ? `on section ${c.anchor.section}`
            : 'on the file'
      ctx.say(`    ${c.id.padEnd(4)} ${on}: ${truncate(c.body, 70)}${replies(c.replies.length)}`)
    }
  }
  return EXIT.ok
}

const replies = (n: number) => (n ? ` (${n} repl${n === 1 ? 'y' : 'ies'})` : '')
