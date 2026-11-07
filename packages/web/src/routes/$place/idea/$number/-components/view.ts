// The API's idea, as the page shows it: who did something (a person, or an
// agent labeled as one), the idea's status as ui's components know it, and
// where each comment sits in the file shown.
import type { Caller, Operations, Output } from '@ideaf/api'
import type { Actor, IdeaStatus, Person } from '@ideaf/ui'
import { headingOffset, toSource } from './anchors.ts'

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
  | { kind: 'file' }
  | { kind: 'outdated' }

/** Where a comment goes in this file, or null if it's on another one. */
export function place(thread: Thread, file: FileView): Placement | null {
  if (thread.state === 'outdated' || !thread.anchor) {
    // its text isn't in this version: listed with every file, under "not in this version"
    return { kind: 'outdated' }
  }
  if (thread.anchor.file !== file.id) {
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
    case 'file':
      return { kind: 'file' }
  }
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

const STATUSES: readonly IdeaStatus[] = ['draft', 'requesting review', 'changes in progress', 'approved', 'closed']

/** The idea's status as ui shows it; one it doesn't know reads as a draft. */
export function statusOf(status: string): IdeaStatus {
  return STATUSES.includes(status as IdeaStatus) ? (status as IdeaStatus) : 'draft'
}
