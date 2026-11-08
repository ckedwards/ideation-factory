/// <reference types="bun" />
import { expect, test } from 'bun:test'
import { parseMarkdown } from '@ideaf/core'
import { actorOf, type FileView, place, statusOf, type Thread } from './view.ts'

const source = '# Plan\n\nShip it **soon**.\n\n## Risks\n\nRain.\n'
const file: FileView = {
  id: 'f1',
  path: 'plan.md',
  source,
  unitIds: parseMarkdown(source).units.map((_, i) => `u${i}`),
}
const plain = parseMarkdown(source).plain.text
const thread = (anchor: Thread['anchor'], state: Thread['state'] = 'exact'): Thread => ({
  id: 'c1',
  author: { user: 'u-riley', bot: null, purpose: 'me' },
  createdAt: 0,
  body: 'Why?',
  version: 1,
  pending: false,
  resolved: false,
  state,
  anchor,
  lastVersion: null,
  addressedIn: [],
  suggestion: null,
  replies: [],
})

test('a text comment marks its words in the source', () => {
  const start = plain.indexOf('soon')
  const placed = place(thread({ kind: 'text', file: 'f1', start, end: start + 4, quote: 'soon' }), file)
  expect(placed).toEqual({ kind: 'text', start: source.indexOf('soon'), end: source.indexOf('soon') + 4 })
})

test('a section comment sits at its heading; one on a unit that is no heading, on the file', () => {
  expect(place(thread({ kind: 'section', file: 'f1', section: 'u2' }), file)).toEqual({
    kind: 'section',
    heading: source.indexOf('## Risks'),
  })
  expect(place(thread({ kind: 'section', file: 'f1', section: 'u1' }), file)).toEqual({ kind: 'file' })
})

test('on another file: not here; outdated: listed with every file', () => {
  expect(place(thread({ kind: 'file', file: 'f2' }), file)).toBeNull()
  expect(place(thread(null, 'outdated'), file)).toEqual({ kind: 'outdated' })
})

test('agent work is labeled; someone not loaded yet shows by ID', () => {
  const riley = new Map([['u-riley', { id: 'u-riley', name: 'Riley Park', handle: 'riley' }]])
  expect(actorOf({ user: 'u-riley', bot: null, purpose: 'me' }, riley)).toEqual({
    kind: 'person',
    person: riley.get('u-riley')!,
  })
  expect(actorOf({ user: 'u-riley', bot: 'planbot', purpose: 'bot-for-me' }, riley)).toMatchObject({
    kind: 'bot-for-person',
    bot: 'planbot',
  })
  expect(actorOf({ user: 'u-x', bot: 'archbot', purpose: 'bot' }, riley)).toEqual({ kind: 'bot', bot: 'archbot' })
  expect(actorOf({ user: 'u-x', bot: null, purpose: 'me' }, riley)).toEqual({
    kind: 'person',
    person: { id: 'u-x', name: 'u-x' },
  })
})

test("each status as ui shows it, and one it doesn't know reads as a draft", () => {
  expect(statusOf('changes-in-progress')).toEqual({ status: 'changes in progress' })
  expect(statusOf('closed-accepted')).toEqual({ status: 'closed', reason: 'accepted' })
  expect(statusOf('something new')).toEqual({ status: 'draft' })
})
