// Suggested edits: what a selection's suggestion replaces, and the replace that
// accepting it applies, wherever its text is by then.
import { describe, expect, test } from 'bun:test'
import { applyBatch } from './apply.ts'
import type { Command } from './batch.ts'
import { type Anchor, createIdea, type Idea, textAnchor } from './idea.ts'
import { acceptSuggestions, suggestionCommand, suggestionSource } from './suggest.ts'

const PLAN = `# Plan

**Offline** sync keeps the [last copy](https://example.com) of each file.

## Risks

It might rain, and rain again.
`
// f1; s2 Plan, b3 its paragraph, s4 Risks, b5 its paragraph

const plan = () => createIdea([{ path: 'plan.md', source: PLAN }])

function old(idea: Idea, anchor: Anchor) {
  const found = suggestionSource(idea, anchor)
  if (!found.ok) {
    throw new Error(found.message)
  }
  return found.old
}

function accept(idea: Idea, anchor: Anchor | null, suggestion: { old: string; new: string }) {
  const built = suggestionCommand(idea, anchor, suggestion, ['c1'])
  if (!built.ok) {
    throw new Error(built.message)
  }
  const comments = anchor ? [{ id: 'c1', anchor }] : []
  const applied = applyBatch(idea, comments, { base: 1, steps: [built.command] })
  if (!applied.ok) {
    throw new Error(JSON.stringify(applied.conflicts))
  }
  return { command: built.command, source: applied.idea.files[0]!.source }
}

describe('what a suggestion replaces', () => {
  test('plain text is taken as it is', () => {
    expect(old(plan(), textAnchor(plan(), 'f1', 'keeps the'))).toBe('keeps the')
  })

  test('a selection cutting through formatting takes it whole', () => {
    const idea = plan()
    expect(old(idea, textAnchor(idea, 'f1', 'line sync'))).toBe('**Offline** sync')
    expect(old(idea, textAnchor(idea, 'f1', 'the last'))).toBe('the [last copy](https://example.com)')
  })

  test('a selection inside formatting stays inside it', () => {
    const idea = plan()
    expect(old(idea, textAnchor(idea, 'f1', 'Offl'))).toBe('Offl')
    expect(old(idea, textAnchor(idea, 'f1', 'last copy'))).toBe('last copy')
  })

  test('a heading, or a range across blocks, is refused or kept to its text', () => {
    const idea = plan()
    expect(old(idea, textAnchor(idea, 'f1', 'Risks'))).toBe('Risks')
    expect(suggestionSource(idea, { kind: 'section', file: 'f1', section: 's4' }).ok).toBe(false)
    const across = textAnchor(idea, 'f1', 'Plan\nOffline')
    expect(suggestionSource(idea, across)).toEqual({ ok: false, message: 'a suggestion must stay within one block' })
  })
})

describe('accepting a suggestion', () => {
  test('replaces its text, addressing the suggestion', () => {
    const idea = plan()
    const anchor = textAnchor(idea, 'f1', 'line sync')
    const { command, source } = accept(idea, anchor, { old: '**Offline** sync', new: '**Local-first** sync' })
    expect(command).toEqual({
      command: 'replace',
      in: 'b3',
      old: '**Offline** sync',
      new: '**Local-first** sync',
      addresses: ['c1'],
    })
    expect(source).toContain('**Local-first** sync keeps')
  })

  test('finds its text after its paragraph moved', () => {
    const idea = plan()
    const anchor = textAnchor(idea, 'f1', 'keeps the')
    const moved = applyBatch(idea, [{ id: 'c1', anchor }], {
      base: 1,
      steps: [{ command: 'move', target: 'b3', to: { after: 'b5' } } satisfies Command],
    })
    if (!moved.ok) {
      throw new Error('move failed')
    }
    const { source } = accept(moved.idea, moved.comments[0]!.anchor, { old: 'keeps the', new: 'holds the' })
    expect(source.indexOf('holds the')).toBeGreaterThan(source.indexOf('## Risks'))
  })

  test('picks the occurrence at its comment when the text is in its block twice', () => {
    const idea = plan()
    const second = textAnchor(idea, 'f1', 'rain', 2)
    const { command, source } = accept(idea, second, { old: 'rain', new: 'snow' })
    expect(source).toContain('It might rain, and snow again.')
    expect(command).toMatchObject({ in: 'b5' })
  })

  test('no longer applies once its text changed, or its comment is outdated', () => {
    const idea = plan()
    const anchor = textAnchor(idea, 'f1', 'keeps the')
    const edited = applyBatch(idea, [{ id: 'c1', anchor }], {
      base: 1,
      steps: [{ command: 'replace', in: 'b3', old: 'keeps the', new: 'keeps a' }],
    })
    if (!edited.ok) {
      throw new Error('edit failed')
    }
    expect(suggestionCommand(edited.idea, edited.comments[0]!.anchor, { old: 'keeps the', new: 'x' }, [])).toEqual({
      ok: false,
      message: 'the text it changes has changed since',
    })
    expect(suggestionCommand(idea, null, { old: 'keeps the', new: 'x' }, [])).toEqual({
      ok: false,
      message: "its text isn't in the latest version",
    })
  })
})

describe('accepting several at once', () => {
  test('is one batch, a step for each; one overlapping another stays open', () => {
    const idea = plan()
    const a = { id: 'c1', anchor: textAnchor(idea, 'f1', 'keeps the'), old: 'keeps the', new: 'holds a' }
    const b = { id: 'c2', anchor: textAnchor(idea, 'f1', 'might rain'), old: 'might rain', new: 'may pour' }
    const overlapping = {
      id: 'c3',
      anchor: textAnchor(idea, 'f1', 'the last'),
      old: 'the [last copy](https://example.com)',
      new: 'a copy',
    }
    const comments = [a, b, overlapping].map(({ id, anchor }) => ({ id, anchor }))
    const result = acceptSuggestions(idea, comments, 1, [a, b, overlapping])
    if (!result.ok) {
      throw new Error(JSON.stringify(result.skipped))
    }
    expect(result.accepted).toEqual(['c1', 'c2'])
    expect(result.skipped).toEqual([{ id: 'c3', message: 'its text changed, by a suggestion accepted with it' }])
    expect(result.applied.steps.map((s) => s.addresses)).toEqual([['c1'], ['c2']])
    expect(result.applied.idea.files[0]!.source).toContain('holds a [last copy]')
  })

  test('with none that apply, nothing lands', () => {
    const idea = plan()
    expect(acceptSuggestions(idea, [], 1, [{ id: 'c1', anchor: null, old: 'x', new: 'y' }])).toEqual({
      ok: false,
      skipped: [{ id: 'c1', message: "its text isn't in the latest version" }],
    })
  })
})
