// The API's idea, as the page shows it: who did something (a person, or an
// agent labeled as one), the idea's status as ui's components know it, and
// where each comment sits in the file shown.
import type { Caller, Operations, Output } from '@ideaf/api'
import type { Actor, CommentTarget, Person } from '@ideaf/ui'
export { statusOf } from '../../../../../ideas.ts'
import { blockLabel, blockRange, headingOffset, toSource } from './anchors.ts'

export type Thread = Output<Operations['listComments']>[number]

/** A file of the version shown: its Markdown, and its units' IDs in the order core parses them. */
export interface FileView {
  id: string
  path: string
  source: string
  unitIds: string[]
}

/** Where a comment goes on the page. Text and section offsets are in the file's Markdown source. */
export type Placement =
  | { kind: 'text'; start: number; end: number }
  | { kind: 'section'; heading: number }
  /** A block: its Markdown, from where it starts to where it ends. */
  | { kind: 'block'; start: number; end: number }
  | { kind: 'file' }
  | { kind: 'outdated' }

/**
 * What a comment is on, as its card tags it; `titles` names sections and blocks by ID. One that's
 * outdated is tagged with what it was on where it was last, not as on the whole file: a section or
 * a block gone since is named as it was there.
 */
export function targetOf(thread: Thread, titles: Map<string, string>): CommentTarget {
  const anchor = thread.anchor ?? thread.lastAnchor
  switch (anchor?.kind) {
    case 'text':
      return { kind: 'text', quote: anchor.quote }
    case 'section':
      return {
        kind: 'section',
        title: titles.get(anchor.section) ?? thread.lastUnit?.path.at(-1) ?? 'A section',
      }
    case 'block':
      return {
        kind: 'block',
        label: titles.get(anchor.block) ?? (thread.lastUnit ? blockLabel(thread.lastUnit) : 'Block'),
      }
    case 'file':
      return { kind: 'file' }
    default:
      // on the idea, or (outdated, nowhere known) on nothing: no tag
      return { kind: 'idea' }
  }
}

/** Where a comment goes in this file, or null if it's on another one. */
export function place(thread: Thread, file: FileView): Placement | null {
  if (thread.state === 'outdated' || !thread.anchor) {
    // its text isn't in this version: listed with every file, under "not in this version"
    return { kind: 'outdated' }
  }
  // one on the idea as a whole is in its activity, not on any file
  if (thread.anchor.kind === 'idea' || thread.anchor.file !== file.id) {
    return null
  }
  switch (thread.anchor.kind) {
    case 'text': {
      const range = toSource(file.source, thread.anchor)
      return range ? { kind: 'text', ...range } : { kind: 'outdated' }
    }
    case 'section': {
      const heading = headingOffset(file.source, file.unitIds, thread.anchor.section)
      return heading === null ? { kind: 'file' } : { kind: 'section', heading }
    }
    case 'block': {
      const range = blockRange(file.source, file.unitIds, thread.anchor.block)
      return range ? { kind: 'block', ...range } : { kind: 'outdated' }
    }
    case 'file':
      return { kind: 'file' }
  }
}

/** A face for whoever did something: a person as they are, an agent by its name (its own key, apart from its person's). */
export function personOf(caller: Caller, people: ReadonlyMap<string, Person>): Person {
  if (caller.purpose === 'me') {
    return people.get(caller.user) ?? { id: caller.user, name: 'Someone' }
  }
  const bot = caller.bot ?? 'bot'
  const of = people.get(caller.user)?.name
  return { id: `${caller.user}/${bot}`, name: caller.purpose === 'bot-for-me' && of ? `${bot} for ${of}` : bot }
}

/** Who did something: agent work is always labeled. Someone not loaded yet shows by ID until they are. */
export function actorOf(caller: Caller, people: ReadonlyMap<string, Person>): Actor {
  const person = people.get(caller.user) ?? { id: caller.user, name: caller.user }
  if (caller.purpose === 'bot') {
    return { kind: 'bot', bot: caller.bot ?? 'bot' }
  }
  if (caller.purpose === 'bot-for-me') {
    return { kind: 'bot-for-person', bot: caller.bot ?? 'bot', person }
  }
  return { kind: 'person', person }
}
