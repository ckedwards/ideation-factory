// ideaf comment, end to end: comments on quotes, sections and files, threads,
// replies and resolving, as the owner and as a reviewer.
import { beforeAll, describe, expect, test } from 'bun:test'
import { api, repo, server, token } from './harness.ts'

beforeAll(() => server(), 60_000)

const run = crypto.randomUUID().slice(0, 6)
const h = (name: string) => `${name}-${run}`

const PLAN = `# Plan

We should ship the **offline mode** this quarter.

## Risks

It might rain. It might rain again.
`

async function started() {
  const r = await repo(
    { 'docs/plan.md': PLAN, 'docs/notes.md': '# Notes\n\nIt might rain.\n' },
    { token: token(h('riley')) },
  )
  const { idea } = (await r.ideaf('start', 'docs', '--title', 'Comments', '--json')).json()
  const files = (await api(h('riley')).pull({ idea })).files
  const plan = files.find((f) => f.path === 'docs/plan.md')!.file
  return { r, idea: idea as string, plan }
}

describe('ideaf comment add', () => {
  test('on a quote, found in the plain text: Markdown left out, and ambiguity refused', async () => {
    const { r, idea, plan } = await started()

    // the quote reads as the text does, across the bold
    const added = await r.ideaf(
      'comment',
      'add',
      'Which quarter?',
      '--quote',
      'the offline mode this quarter',
      '--json',
    )
    expect(added.exit).toBe(0)
    expect(added.json()).toMatchObject({ comment: 'c1', version: 1, anchor: { kind: 'text', file: plan } })
    const [thread] = await api(h('riley')).listComments({ idea })
    expect(thread).toMatchObject({ body: 'Which quarter?', anchor: { quote: 'the offline mode this quarter' } })

    // in two files: name one
    const twoFiles = await r.ideaf('comment', 'add', 'Rain?', '--quote', 'It might rain.')
    expect(twoFiles.exit).toBe(2)
    expect(twoFiles.err).toContain('is in 2 files')
    // twice in one file: pick one
    const twice = await r.ideaf('comment', 'add', 'Rain?', '--quote', 'It might rain', '--file', 'docs/plan.md')
    expect(twice.exit).toBe(2)
    expect(twice.err).toContain('--occurrence <1-2>')
    const second = await r.ideaf(
      'comment',
      'add',
      'Again?',
      '--quote',
      'It might rain',
      '--file',
      plan,
      '--occurrence',
      '2',
      '--json',
    )
    expect(second.exit).toBe(0)
    const plain = 'Plan\nWe should ship the offline mode this quarter.\nRisks\nIt might rain. It might rain again.'
    expect(second.json().anchor.start).toBe(plain.lastIndexOf('It might rain'))

    expect((await r.ideaf('comment', 'add', 'x', '--quote', '**offline mode**')).err).toContain('without Markdown')
    expect((await r.ideaf('comment', 'add', 'x', '--quote', 'rain', '--occurrence', '9', '--file', plan)).exit).toBe(2)
  })

  test('on a section or a whole file, and the usage mistakes', async () => {
    const { r, idea, plan } = await started()
    const blocks = (await r.ideaf('show', '--blocks', '--json')).json()
    const risks = blocks.files
      .flatMap((f: { entries: Array<{ id: string; source: string }> }) => f.entries)
      .find((e: { source: string }) => e.source === '## Risks').id

    expect((await r.ideaf('comment', 'add', 'Expand these', '--section', risks)).out).toBe('Added c1 on v1.')
    expect((await r.ideaf('comment', 'add', 'Whole plan', '--file', 'docs/plan.md')).exit).toBe(0)
    expect((await r.ideaf('comment', 'add', 'By ID', '--file', plan)).exit).toBe(0)
    expect((await api(h('riley')).listComments({ idea })).map((c) => c.anchor?.kind)).toEqual([
      'section',
      'file',
      'file',
    ])

    expect((await r.ideaf('comment', 'add', 'On what?')).exit).toBe(2)
    expect((await r.ideaf('comment', 'add', 'x', '--section', risks, '--quote', 'Risks')).exit).toBe(2)
    expect((await r.ideaf('comment', 'add', 'x', '--file', 'nope.md')).exit).toBe(5)
    expect((await r.ideaf('comment', 'add', '  ', '--file', plan)).exit).toBe(2)
    expect((await r.ideaf('comment', 'add', '--file', plan)).exit).toBe(2) // no body
  })
})

describe('ideaf comment threads', () => {
  test('list, show and reply, with a reviewer', async () => {
    const { r, idea } = await started()
    await api(h('maya')).me({}) // seen once, so she can be shared with
    expect((await r.ideaf('share', h('maya'))).exit).toBe(0)
    const maya = await repo({}, { token: token(h('maya')) })

    expect((await r.ideaf('comment', 'list')).out).toContain('No open comments')
    const asked = await maya.ideaf(
      'comment',
      'add',
      'Which quarter?',
      '--idea',
      idea,
      '--quote',
      'this quarter',
      '--json',
    )
    expect(asked.exit).toBe(0)
    expect((await r.ideaf('comment', 'reply', 'c1', 'Q3')).out).toBe('Replied to c1.')

    const listed = await r.ideaf('comment', 'list')
    expect(listed.out).toContain(`c1  @${h('maya')}, v1 · open`)
    expect(listed.out).toContain('on "this quarter" in docs/plan.md')
    expect(listed.out).toContain(`↳ c2 @${h('riley')}: Q3`)
    expect((await r.ideaf('comment', 'show', 'c1', '--json')).json()).toMatchObject({
      id: 'c1',
      replies: [{ body: 'Q3' }],
    })
    expect((await r.ideaf('comment', 'show', 'c9')).exit).toBe(5)
  })

  test('resolve and reopen, and what addressed a thread', async () => {
    const { r, idea } = await started()
    await r.ideaf('comment', 'add', 'Which quarter?', '--quote', 'this quarter')

    // resolving hides it from the list, unless --all
    expect((await r.ideaf('comment', 'resolve', 'c1')).out).toBe('Resolved c1.')
    const after = await r.ideaf('comment', 'list')
    expect(after.out).toContain('No open comments')
    expect(after.out).toContain('1 resolved: --all shows them.')
    expect((await r.ideaf('comment', 'list', '--all', '--json')).json().comments).toMatchObject([
      { id: 'c1', resolved: true },
    ])
    expect((await r.ideaf('comment', 'reopen', 'c1')).exit).toBe(0)
    expect((await r.ideaf('comment', 'list', '--json')).json().comments).toHaveLength(1)

    // an edit that addresses it shows in the thread
    const blocks = (await r.ideaf('show', '--blocks', '--json')).json()
    const para = blocks.files
      .flatMap((f: { entries: Array<{ id: string; source: string }> }) => f.entries)
      .find((e: { source: string }) => e.source.includes('this quarter')).id
    await api(h('riley')).edit({
      idea,
      batch: {
        base: 1,
        steps: [{ command: 'replace', in: para, old: 'this quarter', new: 'in Q3', addresses: ['c1'] }],
      },
    })
    expect((await r.ideaf('comment', 'list')).out).toContain('addressed in v2')

    expect((await r.ideaf('comment', 'resolve')).exit).toBe(2)
    expect((await r.ideaf('comment', 'resolve', 'nope')).exit).toBe(2)
    expect((await r.ideaf('comment', 'list', '--version', 'x')).exit).toBe(2)
  })
})

describe('ideaf comment suggest', () => {
  test('a reviewer suggests; the owner accepts several as one version, and rejects', async () => {
    const { r, idea } = await started()
    await api(h('maya')).me({})
    expect((await r.ideaf('share', h('maya'))).exit).toBe(0)
    const maya = await repo({}, { token: token(h('maya')) })

    // the quote reads as the text does; one with formatting it doesn't show must say so
    const bold = await maya.ideaf('comment', 'suggest', 'the local mode', '--idea', idea, '--quote', 'the offline mode')
    expect(bold.exit).toBe(2)
    expect(bold.err).toContain('is "the **offline mode**" in the source')
    expect(bold.err).toContain('--replaces "the **offline mode**"')
    const confirmed = await maya.ideaf(
      'comment',
      'suggest',
      'the **local mode**',
      '--idea',
      idea,
      '--quote',
      'the offline mode',
      '--replaces',
      'the **offline mode**',
      '-m',
      'Clearer',
      '--json',
    )
    expect(confirmed.exit).toBe(0)
    expect(confirmed.json()).toMatchObject({ comment: 'c1', old: 'the **offline mode**', new: 'the **local mode**' })
    const quarter = await maya.ideaf('comment', 'suggest', 'in Q3', '--idea', idea, '--quote', 'this quarter')
    expect(quarter.out).toBe('Suggested c2 on v1: "this quarter" → "in Q3".')
    await maya.ideaf(
      'comment',
      'suggest',
      'It may rain',
      '--idea',
      idea,
      '--quote',
      'It might rain',
      '--file',
      'docs/notes.md',
    )

    const listed = await r.ideaf('comment', 'list')
    expect(listed.out).toContain(`c1  @${h('maya')}, v1 · suggestion · open`)
    expect(listed.out).toContain('suggests "the **offline mode**" → "the **local mode**"')

    // a reviewer can't decide; the owner accepts two as one version, and rejects the third
    expect((await maya.ideaf('comment', 'accept', 'c1', '--idea', idea)).exit).not.toBe(0)
    expect((await r.ideaf('comment', 'accept', 'c1', 'c2')).out).toBe('Accepted c1, c2 as v2.')
    expect((await r.ideaf('comment', 'reject', 'c3')).out).toBe('Rejected c3.')
    const plan = (await api(h('riley')).pull({ idea })).files.find((f) => f.path === 'docs/plan.md')!
    expect(plan.content).toContain('We should ship the **local mode** in Q3.')
    const all = await r.ideaf('comment', 'list', '--all')
    expect(all.out).toContain('suggestion · accepted in v2')
    expect(all.out).toContain('suggestion · rejected')

    // accepting again: nothing applies
    const again = await r.ideaf('comment', 'accept', 'c1')
    expect(again.exit).not.toBe(0)
    expect(again.err).toContain('c1, it was accepted in v2')
  })
})
