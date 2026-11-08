// Editing a block in place, as the web app does: a block's new source becomes
// the smallest command that makes it so, so comments on the text that didn't
// change keep their place.
//
// - **A block:** a `replace` of only what changed (the common start and end
//   left alone), taking in surrounding text until it's unique in the block.
//   Emptying it is a `delete`.
// - **A heading:** a `rename-heading`, so its section's comments stay. Its
//   level doesn't change here.
import type { Command } from './batch.ts'
import { type Idea, locate } from './idea.ts'
import { uniqueReplace } from './suggest.ts'

export type BlockEdit = { ok: true; commands: Command[] } | { ok: false; message: string }

/** The commands that make block (or heading) `id` read `next`; none if it already does. */
export function blockEdit(idea: Idea, id: string, next: string): BlockEdit {
  const at = locate(idea, id)
  if (!at) {
    return { ok: false, message: `${id} isn't in this version` }
  }
  const { parsed, unit, file } = at
  const u = parsed.units[unit]!
  const before = file.source.slice(u.start, u.end)
  if (u.kind === 'heading') {
    const title = next
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/\s+#+\s*$/, '')
      .trim()
    if (!title || /[\r\n]/.test(title)) {
      return { ok: false, message: 'a heading is one line of text' }
    }
    const current = before
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/\s+#+\s*$/, '')
      .trim()
    return {
      ok: true,
      commands: title === current ? [] : [{ command: 'rename-heading', target: id, title, expect: before }],
    }
  }
  const after = next.trim()
  if (after === before.trim()) {
    return { ok: true, commands: [] }
  }
  if (!after) {
    return { ok: true, commands: [{ command: 'delete', target: id, expect: before }] }
  }
  // the smallest change: leave the common start and end alone
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start++
  }
  let end = 0
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++
  }
  const command = uniqueReplace(
    parsed,
    unit,
    id,
    u.start + start,
    u.start + before.length - end,
    after.slice(start, after.length - end),
  )
  return command
    ? { ok: true, commands: [command] }
    : { ok: false, message: `${id} can't be told apart from text around it` }
}
