// IdeaService without Rivet: bun:sqlite in memory, an in-memory file store and
// core in process. The actor test covers the same flows through RivetKit.
import { describe, expect, test } from 'bun:test'
import { contentHash } from '@ideaf/core'
import { inProcessCore } from '../core-pool/runner.ts'
import { MemoryFileStore } from '../files/memory.ts'
import { DEFAULT_LIMITS, type Limits } from '../limits.ts'
import { migrate } from './schema.ts'
import { type Caller, IdeaService, type WriteResult } from './service.ts'
import { bunSql } from '../sql/sql-bun.ts'

const OWNER: Caller = { user: 'riley', bot: null, purpose: 'me' }
const REVIEWER: Caller = { user: 'maya', bot: null, purpose: 'me' }
const PLAN = '# Plan\n\nThe quick brown fox.\n\n## Risks\n\nIt might rain.\n'
// IDs: f1; s2 Plan, b3, s4 Risks, b5

async function setup(limits: Limits = DEFAULT_LIMITS) {
  const sql = bunSql()
  await migrate(sql)
  const files = new MemoryFileStore()
  let clock = 1_000
  const service = new IdeaService('idea-1', { sql, files, core: inProcessCore(), limits, now: () => clock++ })
  let n = 0
  const write = async (write: unknown, caller: Caller = OWNER, key = `k${++n}`) =>
    (await service.write({ key, caller, write })).result
  return { sql, files, service, write }
}

async function created() {
  const s = await setup()
  expect(await s.write({ type: 'create', title: 'Plan', files: [{ path: 'plan.md', content: PLAN }] })).toEqual({
    ok: true,
    value: { kind: 'created', version: 1 },
  })
  return s
}

const value = (r: WriteResult) => {
  if (!r.ok) {
    throw new Error(`expected ok: ${JSON.stringify(r.error)}`)
  }
  return r.value
}

describe('creating an idea', () => {
  test('stores v1: its manifest in SQL, its contents in the file store by hash', async () => {
    const { service, files } = await created()
    const summary = await service.summary()
    expect(summary).toMatchObject({ id: 'idea-1', title: 'Plan', owner: 'riley', status: 'draft', latest: 1 })
    expect(summary!.versions).toEqual([
      { number: 1, parent: null, createdAt: expect.any(Number), by: OWNER, how: 'created', steps: 0 },
    ])
    const manifest = await service.files()
    expect(manifest).toEqual([{ file: 'f1', path: 'plan.md', hash: await contentHash(PLAN), bytes: PLAN.length }])
    expect(await files.has(manifest[0]!.hash)).toBe(true)
    expect((await service.file(1, 'f1'))!.content).toBe(PLAN)
    expect((await service.outline()).map((f) => f.entries.map((e) => e.id))).toEqual([['s2', 'b3', 's4', 'b5']])
  })

  test("can't be created twice, and needs valid paths", async () => {
    const { write } = await created()
    expect(await write({ type: 'create', title: 'Again', files: [{ path: 'x.md', content: '' }] })).toMatchObject({
      ok: false,
      error: { code: 'exists' },
    })
    const fresh = await setup()
    expect(
      await fresh.write({ type: 'create', title: 'Bad', files: [{ path: '../x.md', content: '' }] }),
    ).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(await fresh.write({ type: 'create', title: '', files: [{ path: 'a.md', content: '' }] })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    })
  })
})

describe('editing with a batch', () => {
  test('makes a new version with its steps, and moves comments by rule', async () => {
    const { service, write } = await created()
    const comment = value(
      await write(
        { type: 'comment', version: 1, anchor: { kind: 'text', file: 'f1', start: 15, end: 20 }, body: 'Which brown?' },
        REVIEWER,
      ),
    )
    expect(comment).toEqual({ kind: 'comment', comment: 'c1' })
    const section = value(
      await write(
        { type: 'comment', version: 1, anchor: { kind: 'section', section: 's4' }, body: 'Add more risks' },
        REVIEWER,
      ),
    )
    const block = value(
      await write(
        { type: 'comment', version: 1, anchor: { kind: 'block', block: 'b5' }, body: 'How likely?' },
        REVIEWER,
      ),
    )

    const edited = value(
      await write({
        type: 'edit',
        batch: {
          base: 1,
          steps: [
            { command: 'replace', in: 'b3', old: 'brown', new: 'red', addresses: ['c1'] },
            { command: 'move', target: 's4', to: { start: 'f1' } },
          ],
        },
      }),
    )
    expect(edited).toMatchObject({ kind: 'version', version: 2 })
    expect((await service.file(2, 'f1'))!.content).toBe('## Risks\n\nIt might rain.\n\n# Plan\n\nThe quick red fox.\n')
    expect(await service.steps(2)).toEqual([
      {
        step: 0,
        command: { command: 'replace', in: 'b3', old: 'brown', new: 'red', addresses: ['c1'] },
        addresses: ['c1'],
      },
      { step: 1, command: { command: 'move', target: 's4', to: { start: 'f1' } }, addresses: [] },
    ])

    const v2 = await service.comments(2)
    expect(
      v2.map((c) => [c.id, c.state, c.anchor?.kind === 'text' ? c.anchor.quote : c.anchor?.kind, c.addressedIn]),
    ).toEqual([
      ['c1', 'changed', 'red', [2]],
      [(section as { comment: string }).comment, 'moved', 'section', []],
      // the block moved with its section, and its comment with it
      [(block as { comment: string }).comment, 'moved', 'block', []],
    ])
    // older versions still show comments where they were then
    const v1 = await service.comments(1)
    expect(v1.map((c) => [c.id, c.state, c.anchor?.kind === 'text' ? c.anchor.quote : c.anchor?.kind])).toEqual([
      ['c1', 'exact', 'brown'],
      ['c2', 'exact', 'section'],
      ['c3', 'exact', 'block'],
    ])
  })

  test('a comment that becomes outdated links to the last version where it applied, and what it was on there', async () => {
    const { service, write } = await created()
    // plain text: "Plan\nThe quick brown fox.\nRisks\nIt might rain."; "rain" is 41–45
    await write({
      type: 'comment',
      version: 1,
      anchor: { kind: 'text', file: 'f1', start: 41, end: 45 },
      body: 'Rain?',
    })
    await write({ type: 'edit', batch: { base: 1, steps: [{ command: 'delete', target: 'b5' }] } })
    await write({
      type: 'edit',
      batch: { base: 2, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'More.' }] },
    })
    const [c] = await service.comments(3)
    expect(c).toMatchObject({
      id: 'c1',
      state: 'outdated',
      anchor: null,
      lastVersion: 1,
      lastAnchor: { kind: 'text', file: 'f1', quote: 'rain' },
    })
    // as of version 1, it's attached, and has no last anchor of its own
    const [then] = await service.comments(1)
    expect(then).toMatchObject({ state: 'exact', lastAnchor: null })
  })

  test('a comment on a block that goes is outdated, with the block as it was', async () => {
    const { service, write } = await created()
    await write({ type: 'comment', version: 1, anchor: { kind: 'block', block: 'b5' }, body: 'Rain?' })
    await write({ type: 'edit', batch: { base: 1, steps: [{ command: 'delete', target: 'b5' }] } })
    const [c] = await service.comments(2)
    expect(c).toMatchObject({
      state: 'outdated',
      lastAnchor: { kind: 'block', block: 'b5' },
      lastUnit: { id: 'b5', kind: 'paragraph', path: ['Plan', 'Risks'], source: 'It might rain.' },
    })
  })

  test('a stale batch replays onto the latest version, or conflicts', async () => {
    const { write } = await created()
    await write({
      type: 'edit',
      batch: { base: 1, steps: [{ command: 'replace', in: 'b5', old: 'rain', new: 'snow' }] },
    })
    expect(
      await write({
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'quick', new: 'slow' }] },
      }),
    ).toMatchObject({
      ok: true,
      value: { version: 3 },
    })
    expect(
      await write({
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'replace', in: 'b5', old: 'rain', new: 'hail' }] },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'conflict', details: { conflicts: [{ step: 0, reason: 'no_match' }] } },
    })
  })

  test('a preview shows the result without changing anything', async () => {
    const { service } = await created()
    const preview = await service.preview({
      base: 1,
      steps: [{ command: 'replace', in: 'b3', old: 'brown', new: 'red' }],
    })
    expect(preview).toMatchObject({
      ok: true,
      base: 1,
      files: [{ file: 'f1', path: 'plan.md', before: PLAN, content: PLAN.replace('brown', 'red') }],
    })
    expect((await service.summary())!.latest).toBe(1)
  })
})

describe('uploading an edited copy', () => {
  test('needs the latest version as its base, unless forced', async () => {
    const { service, write } = await created()
    const base = await contentHash(PLAN)
    const v2 = PLAN.replace('rain', 'snow')
    expect(
      value(await write({ type: 'upload', files: [{ file: 'f1', path: 'plan.md', content: v2, base }] })),
    ).toMatchObject({ version: 2 })
    expect((await service.summary())!.versions.at(-1)!.how).toBe('upload')
    // uploading again from the old base: pull first
    const stale = await write({
      type: 'upload',
      files: [{ file: 'f1', path: 'plan.md', content: PLAN.replace('rain', 'hail'), base }],
    })
    expect(stale).toMatchObject({
      ok: false,
      error: { code: 'pull_first', details: { files: [{ file: 'f1', base, latest: await contentHash(v2) }] } },
    })
    // or force it
    expect(
      await write({
        type: 'upload',
        force: true,
        files: [{ file: 'f1', path: 'plan.md', content: PLAN.replace('rain', 'hail'), base }],
      }),
    ).toMatchObject({
      ok: true,
      value: { version: 3 },
    })
  })

  test('re-anchors comments through the diff', async () => {
    const { service, write } = await created()
    await write({
      type: 'comment',
      version: 1,
      anchor: { kind: 'text', file: 'f1', start: 15, end: 20 },
      body: 'Which brown?',
    })
    const content = PLAN.replace('The quick brown fox.', 'The quick **brown** fox\njumps.')
    await write({ type: 'upload', files: [{ file: 'f1', path: 'plan.md', content, base: await contentHash(PLAN) }] })
    // bold and re-wrapping don't change the plain text the comment is on
    const [c] = await service.comments(2)
    expect(c).toMatchObject({ state: 'exact', anchor: { quote: 'brown' } })
  })
})

describe('where an idea is in git', () => {
  test('is set when it is created, follows each upload that says, and is never a URL', async () => {
    const { service, write } = await setup()
    const uri = 'github.com/acme/plans'
    value(
      await write({
        type: 'create',
        title: 'Plan',
        files: [{ path: 'plan.md', content: PLAN }],
        gitHint: { uri, branch: 'idea/plan' },
      }),
    )
    expect((await service.summary())!.gitHint).toEqual({ uri, branch: 'idea/plan' })

    let base = await contentHash(PLAN)
    const upload = async (content: string, gitHint?: unknown) => {
      const result = await write({
        type: 'upload',
        files: [{ file: 'f1', path: 'plan.md', content, base }],
        ...(gitHint ? { gitHint } : {}),
      })
      if (result.ok) {
        base = await contentHash(content)
      }
      return result
    }
    value(await upload(PLAN.replace('rain', 'snow'), { uri: null, branch: 'elsewhere' }))
    expect((await service.summary())!.gitHint).toEqual({ uri: null, branch: 'elsewhere' })
    // an upload that doesn't say leaves it
    value(await upload(PLAN.replace('rain', 'hail')))
    expect((await service.summary())!.gitHint).toEqual({ uri: null, branch: 'elsewhere' })

    expect(await upload(PLAN, { uri: 'https://ghp_token@github.com/acme/plans.git', branch: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    })
    expect((await service.summary())!.gitHint).toEqual({ uri: null, branch: 'elsewhere' })
  })

  test('is unknown for an idea created without it', async () => {
    const { service } = await created()
    expect((await service.summary())!.gitHint).toBeNull()
  })
})

describe('size limits', () => {
  const small: Limits = { maxFileBytes: 100, maxIdeaBytes: 150 }

  test('refuse a file or an idea over the limit, before parsing', async () => {
    const s = await setup(small)
    expect(
      await s.write({ type: 'create', title: 'Big', files: [{ path: 'a.md', content: 'x'.repeat(101) }] }),
    ).toMatchObject({
      ok: false,
      error: { code: 'too_large', message: 'a.md is 1 KB; the limit for a file is 1 KB' },
    })
    expect(
      await s.write({
        type: 'create',
        title: 'Big',
        files: [
          { path: 'a.md', content: 'x'.repeat(80) },
          { path: 'b.md', content: 'x'.repeat(80) },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'too_large', details: { problems: [{ path: null, bytes: 160, limit: 150 }] } },
    })
  })

  test('apply to the result of a batch', async () => {
    const s = await setup(small)
    await s.write({ type: 'create', title: 'Small', files: [{ path: 'a.md', content: 'Short.\n' }] })
    expect(
      await s.write({
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'y'.repeat(120) }] },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'too_large' },
    })
  })

  test('an idea already over a lowered limit can still change if it does not grow', async () => {
    const sql = bunSql()
    await migrate(sql)
    const files = new MemoryFileStore()
    const big = new IdeaService('i', { sql, files, core: inProcessCore(), limits: DEFAULT_LIMITS })
    const content = `Start. ${'filler '.repeat(30)}End.\n`
    await big.write({
      key: 'a',
      caller: OWNER,
      write: { type: 'create', title: 'T', files: [{ path: 'a.md', content }] },
    })
    const lowered = new IdeaService('i', { sql, files, core: inProcessCore(), limits: small })
    const shrunk = await lowered.write({
      key: 'b',
      caller: OWNER,
      write: {
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'replace', in: 'b2', old: 'Start. filler', new: 'Start.' }] },
      },
    })
    expect(shrunk.result).toMatchObject({ ok: true })
    const grown = await lowered.write({
      key: 'c',
      caller: OWNER,
      write: { type: 'edit', batch: { base: 2, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'More.' }] } },
    })
    expect(grown.result).toMatchObject({ ok: false, error: { code: 'too_large' } })
  })
})

describe('comments', () => {
  test('replies, resolving, and anchors checked against the latest version', async () => {
    const { service, write } = await created()
    expect(
      await write({ type: 'comment', version: 1, anchor: { kind: 'text', file: 'f1', start: 0, end: 999 }, body: 'x' }),
    ).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(
      await write({ type: 'comment', version: 1, anchor: { kind: 'section', section: 'b3' }, body: 'x' }),
    ).toMatchObject({ ok: false, error: { code: 'invalid' } })
    // a block is any but a heading, whose comment is on its section
    expect(
      await write({ type: 'comment', version: 1, anchor: { kind: 'block', block: 's4' }, body: 'x' }),
    ).toMatchObject({ ok: false, error: { code: 'invalid' } })
    value(await write({ type: 'comment', version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'Overall: good' }))
    value(await write({ type: 'reply', parent: 'c1', body: 'Thanks' }, REVIEWER))
    value(await write({ type: 'resolve', comment: 'c1', resolved: true }))
    await write({ type: 'edit', batch: { base: 1, steps: [{ command: 'delete', target: 'b3' }] } })
    expect(
      await write({ type: 'comment', version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'late' }),
    ).toMatchObject({ ok: false, error: { code: 'stale_version' } })
    const [c] = await service.comments()
    expect(c).toMatchObject({
      id: 'c1',
      resolved: true,
      state: 'exact',
      body: 'Overall: good',
      replies: [{ id: 'c2', body: 'Thanks', author: REVIEWER }],
    })
  })
  test('a comment on the idea as a whole stays as it is through edits, uploads and deleted files', async () => {
    const { service, write } = await created()
    value(await write({ type: 'comment', version: 1, anchor: { kind: 'idea' }, body: 'Worth a pilot' }, REVIEWER))
    await write({ type: 'edit', batch: { base: 1, steps: [{ command: 'delete', target: 'b3' }] } })
    await write({
      type: 'edit',
      batch: { base: 2, steps: [{ command: 'create-file', path: 'notes.md', markdown: 'Hi.' }] },
    })
    await write({ type: 'edit', batch: { base: 3, steps: [{ command: 'delete-file', file: 'f1' }] } })
    for (const version of [1, 2, 3, 4]) {
      const [c] = await service.comments(version)
      expect(c).toMatchObject({ id: 'c1', state: 'exact', anchor: { kind: 'idea' }, body: 'Worth a pilot' })
    }
  })
})

describe('suggested edits', () => {
  // "quick brown" is plain text 9–20 of plan.md; "might rain" is 35–45
  const QUICK = { kind: 'text', file: 'f1', start: 9, end: 20 } as const
  const RAIN = { kind: 'text', file: 'f1', start: 35, end: 45 } as const

  test('a suggestion is a comment carrying its change, and anyone who can comment can make one', async () => {
    const { service, write } = await created()
    expect(await service.suggestionSource('f1', 9, 20)).toEqual({ version: 1, old: 'quick brown' })
    const made = value(
      await write({ type: 'suggest', version: 1, anchor: QUICK, new: 'slow red', body: 'calmer' }, REVIEWER),
    )
    expect(made).toEqual({ kind: 'suggestion', comment: 'c1', old: 'quick brown' })
    const [thread] = await service.comments()
    expect(thread).toMatchObject({
      id: 'c1',
      author: REVIEWER,
      body: 'calmer',
      state: 'exact',
      suggestion: { old: 'quick brown', new: 'slow red', decision: null },
    })
    expect(await write({ type: 'suggest', version: 1, anchor: QUICK, new: 'quick brown', body: '' })).toMatchObject({
      ok: false,
      error: { code: 'invalid', message: "the suggestion doesn't change anything" },
    })
  })

  test('accepting several adds them to the draft, and committing it is one version, a step for each; the rest stay open, saying why', async () => {
    const { service, write } = await created()
    value(await write({ type: 'suggest', version: 1, anchor: QUICK, new: 'slow red', body: '' }, REVIEWER))
    value(await write({ type: 'suggest', version: 1, anchor: RAIN, new: 'may pour', body: '' }, REVIEWER))
    // overlaps the first: "brown" is gone once it's in the draft
    const BROWN = { kind: 'text', file: 'f1', start: 15, end: 24 } as const
    value(await write({ type: 'suggest', version: 1, anchor: BROWN, new: 'brown cat', body: '' }, REVIEWER))
    const result = value(await write({ type: 'accept', suggestions: ['c1', 'c2', 'c3'] }))
    expect(result).toMatchObject({
      kind: 'drafted',
      accepted: ['c1', 'c2'],
      skipped: [{ id: 'c3', message: expect.any(String) }],
    })
    // no version until the draft's committed
    expect((await service.summary())!.latest).toBe(1)
    expect(value(await write({ type: 'commit' }))).toMatchObject({ version: 2 })
    expect((await service.file(2, 'f1'))!.content).toBe('# Plan\n\nThe slow red fox.\n\n## Risks\n\nIt may pour.\n')
    expect((await service.steps(2)).map((s) => s.addresses)).toEqual([['c1'], ['c2']])
    const threads = await service.comments()
    const decided = { kind: 'accepted' as const, by: OWNER, at: expect.any(Number), version: 2 }
    expect(threads.map((t) => [t.id, t.resolved, t.suggestion?.decision ?? null, t.addressedIn])).toEqual([
      ['c1', true, decided, [2]],
      ['c2', true, decided, [2]],
      ['c3', false, null, []],
    ])
    // as of v1, they were still open
    expect((await service.comments(1)).map((t) => t.suggestion?.decision ?? null)).toEqual([null, null, null])
    // accepting again skips it; with nothing left to apply, nothing changes
    expect(await write({ type: 'accept', suggestions: ['c1'] })).toMatchObject({
      ok: false,
      error: { code: 'conflict', details: { skipped: [{ id: 'c1', message: 'it was accepted in v2' }] } },
    })
  })

  test('rejecting resolves it, and makes no version; an accepted one can only be undone by editing', async () => {
    const { service, write } = await created()
    value(await write({ type: 'suggest', version: 1, anchor: QUICK, new: 'slow red', body: '' }, REVIEWER))
    value(await write({ type: 'suggest', version: 1, anchor: RAIN, new: 'may pour', body: '' }, REVIEWER))
    expect(value(await write({ type: 'reject', suggestion: 'c1' }))).toEqual({ kind: 'rejected', comment: 'c1' })
    value(await write({ type: 'accept', suggestions: ['c2'] }))
    value(await write({ type: 'commit' }))
    expect(await write({ type: 'reject', suggestion: 'c2' })).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(await write({ type: 'reject', suggestion: 'c9' })).toMatchObject({ ok: false, error: { code: 'not_found' } })
    const [c1] = await service.comments()
    expect(c1).toMatchObject({ resolved: true, suggestion: { decision: { kind: 'rejected', version: null } } })
    expect((await service.summary())!.latest).toBe(2)
  })

  test('a suggestion whose text changed or went no longer applies', async () => {
    const { write } = await created()
    value(await write({ type: 'suggest', version: 1, anchor: QUICK, new: 'slow red', body: '' }, REVIEWER))
    value(await write({ type: 'edit', batch: { base: 1, steps: [{ command: 'delete', target: 'b3' }] } }))
    expect(await write({ type: 'accept', suggestions: ['c1'] })).toMatchObject({
      ok: false,
      error: {
        code: 'conflict',
        details: { skipped: [{ id: 'c1', message: 'its text is gone' }] },
      },
    })
  })
})

describe('the draft', () => {
  // f1; s2 Plan, b3 "The quick brown fox.", s4 Risks, b5 "It might rain."; next ID 6
  const RAIN = { kind: 'text', file: 'f1', start: 35, end: 45 } as const

  test('collects changes, checked against it, and commits them as one version', async () => {
    const { service, write } = await created()
    expect((await service.draft()).changes).toEqual([])
    const first = value(
      await write({
        type: 'draft',
        changes: [{ kind: 'edit', id: 'b3', source: 'The quick red fox.', was: 'The quick brown fox.' }],
      }),
    )
    // editing it again straight after is the same change
    const again = value(
      await write({
        type: 'draft',
        changes: [{ kind: 'edit', id: 'b3', source: 'The slow red fox.', was: 'The quick red fox.' }],
      }),
    )
    expect(again).toEqual(first)
    value(await write({ type: 'draft', changes: [{ kind: 'insert', at: { after: 'b3' }, markdown: 'New.' }] }))
    // made against what the block used to read: outdated, and refused
    expect(
      await write({ type: 'draft', changes: [{ kind: 'edit', id: 'b3', source: 'x', was: 'The quick brown fox.' }] }),
    ).toMatchObject({
      ok: false,
      error: { code: 'conflict', details: { problem: expect.stringContaining('changed') } },
    })

    const draft = await service.draft()
    expect(draft.changes.map((c) => c.change.kind)).toEqual(['edit', 'insert'])
    expect(draft.files[0]!.content).toBe('# Plan\n\nThe slow red fox.\n\nNew.\n\n## Risks\n\nIt might rain.\n')
    expect(draft.files[0]!.units.find((u) => u.source === 'New.')).toMatchObject({ id: 'b6', origin: { kind: 'new' } })
    // the latest version is untouched until it's committed
    expect((await service.summary())!.latest).toBe(1)

    expect(value(await write({ type: 'commit' }))).toMatchObject({ kind: 'version', version: 2 })
    expect((await service.file(2, 'f1'))!.content).toBe(draft.files[0]!.content)
    expect((await service.outline()).map((f) => f.entries.map((e) => e.id))).toEqual([['s2', 'b3', 'b6', 's4', 'b5']])
    expect((await service.draft()).changes).toEqual([])
    expect(await write({ type: 'commit' })).toMatchObject({ ok: false, error: { code: 'invalid' } })
  })

  test('takes several changes at once, all or none', async () => {
    const { service, write } = await created()
    const both = value(
      await write({
        type: 'draft',
        changes: [
          { kind: 'edit', id: 'b3', source: 'The quick red fox.', was: 'The quick brown fox.' },
          { kind: 'move', id: 'b3', to: { after: 'b5' }, was: 'The quick red fox.' },
        ],
      }),
    )
    expect(both).toMatchObject({ kind: 'draft', keys: [expect.any(String), expect.any(String)] })
    expect((await service.draft()).files[0]!.content).toBe(
      '# Plan\n\n## Risks\n\nIt might rain.\n\nThe quick red fox.\n',
    )
    // the second is outdated (the first changed the block): neither goes in
    expect(
      await write({
        type: 'draft',
        changes: [
          { kind: 'edit', id: 'b5', source: 'It may rain.', was: 'It might rain.' },
          { kind: 'delete', id: 'b5', was: 'It might rain.' },
        ],
      }),
    ).toMatchObject({ ok: false, error: { code: 'conflict', details: { change: 1 } } })
    expect((await service.draft()).changes).toHaveLength(2)
  })

  test('keeps the difference: a block edited back to how it was leaves no change', async () => {
    const { service, write } = await created()
    value(
      await write({
        type: 'draft',
        changes: [{ kind: 'edit', id: 'b3', source: 'The quick red fox.', was: 'The quick brown fox.' }],
      }),
    )
    const back = value(
      await write({
        type: 'draft',
        changes: [{ kind: 'edit', id: 'b3', source: 'The quick brown fox.', was: 'The quick red fox.' }],
      }),
    )
    expect(back).toEqual({ kind: 'draft', keys: [null] })
    expect((await service.draft()).changes).toEqual([])
  })

  test('is on the latest version: a version made elsewhere can make its changes outdated', async () => {
    const { service, write } = await created()
    const stale = value(
      await write({
        type: 'draft',
        changes: [{ kind: 'edit', id: 'b3', source: 'The quick red fox.', was: 'The quick brown fox.' }],
      }),
    )
    value(
      await write({
        type: 'draft',
        changes: [{ kind: 'edit', id: 'b5', source: 'It may pour.', was: 'It might rain.' }],
      }),
    )
    // an agent's batch changes the fox: it has to confirm it outdates the draft's edit
    const batch = { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'quick', new: 'slow' }] }
    expect(await write({ type: 'edit', batch })).toMatchObject({
      ok: false,
      error: {
        code: 'draft_outdated',
        message: 'this version would make a change in the draft outdated; confirm to make it anyway',
        details: { changes: [{ key: (stale as { keys: string[] }).keys[0], by: OWNER }] },
      },
    })
    expect((await service.summary())!.latest).toBe(1)
    value(await write({ type: 'edit', batch, outdateDraft: true }))
    const draft = await service.draft()
    expect(draft.version).toBe(2)
    expect(draft.changes.map((c) => c.problem)).toEqual([
      'that block has changed since; undo this, and edit it again',
      null,
    ])
    expect(await write({ type: 'commit' })).toMatchObject({
      ok: false,
      error: { code: 'conflict', message: '1 change is outdated: undo or redo it first' },
    })
    value(await write({ type: 'undraft', key: (stale as { keys: string[] }).keys[0] }))
    expect(value(await write({ type: 'commit' }))).toMatchObject({ version: 3 })
    expect((await service.file(3, 'f1'))!.content).toContain('The slow brown fox.\n\n## Risks\n\nIt may pour.')
  })

  test("a version that leaves the draft's changes applying needs no confirming", async () => {
    const { write } = await created()
    value(
      await write({
        type: 'draft',
        changes: [{ kind: 'edit', id: 'b5', source: 'It may pour.', was: 'It might rain.' }],
      }),
    )
    const batch = { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'quick', new: 'slow' }] }
    expect(value(await write({ type: 'edit', batch }))).toMatchObject({ version: 2 })
  })

  test('a suggestion in the draft, rejected, leaves the draft', async () => {
    const { service, write } = await created()
    value(await write({ type: 'suggest', version: 1, anchor: RAIN, new: 'may pour', body: '' }, REVIEWER))
    value(await write({ type: 'accept', suggestions: ['c1'] }))
    value(await write({ type: 'reject', suggestion: 'c1' }))
    expect((await service.draft()).changes).toEqual([])
  })

  test('takes accepted suggestions, which are accepted when it is committed, and open again if it is discarded', async () => {
    const { service, write } = await created()
    value(await write({ type: 'suggest', version: 1, anchor: RAIN, new: 'may pour', body: '' }, REVIEWER))
    const drafted = value(await write({ type: 'accept', suggestions: ['c1'] }))
    expect(drafted).toEqual({ kind: 'drafted', accepted: ['c1'], skipped: [] })
    expect((await service.comments())[0]).toMatchObject({
      resolved: false,
      suggestion: { inDraft: true, decision: null },
    })
    expect((await service.draft()).files[0]!.content).toContain('It may pour.')
    // already in it
    expect(await write({ type: 'accept', suggestions: ['c1'] })).toMatchObject({
      ok: false,
      error: { details: { skipped: [{ id: 'c1', message: 'it’s in the draft already' }] } },
    })

    value(await write({ type: 'discard' }))
    expect((await service.comments())[0]).toMatchObject({ suggestion: { inDraft: false, decision: null } })

    value(await write({ type: 'accept', suggestions: ['c1'] }))
    value(await write({ type: 'commit' }))
    expect((await service.comments())[0]).toMatchObject({
      resolved: true,
      addressedIn: [2],
      suggestion: { inDraft: false, decision: { kind: 'accepted', version: 2 } },
    })
  })

  test('each file it changes is a live document: stored with the steps that made it', async () => {
    const { sql, service, write } = await created()
    value(
      await write({
        type: 'draft',
        changes: [{ kind: 'edit', id: 'b3', source: 'The quick red fox.', was: 'The quick brown fox.' }],
      }),
    )
    value(await write({ type: 'draft', changes: [{ kind: 'insert', at: { after: 'b5' }, markdown: 'Bring a coat.' }] }))
    const [row] = await sql.execute<{ steps: number; doc: string; source: string; ids: string }>(
      'SELECT steps, doc, source, ids FROM draft_files',
    )
    const draft = await service.draft()
    expect(row!.source).toBe(draft.files[0]!.content)
    expect(JSON.parse(row!.ids)).toEqual(['s2', 'b3', 's4', 'b5', 'b6'])
    // the version, opened as the editor opens it, with the stored steps applied, is the stored document
    const steps = await sql.execute<{ step: string; by: string }>('SELECT step, by FROM draft_steps ORDER BY seq')
    expect(steps).toHaveLength(row!.steps)
    expect(JSON.parse(steps[0]!.by)).toEqual(OWNER)
    const { applySteps, pageDocument } = await import('@ideaf/ui/editor/model')
    const opened = await pageDocument(PLAN, ['s2', 'b3', 's4', 'b5'])
    const rebuilt = applySteps(
      opened.schema,
      opened.doc,
      steps.map((s) => JSON.parse(s.step) as unknown),
    )
    expect(rebuilt.toJSON()).toEqual(JSON.parse(row!.doc))
    // each step changed only what changed: the fox's word, then the new paragraph
    expect(JSON.stringify(steps[0]!.step)).not.toContain('Risks')
  })

  test('a fresh actor reads the same draft from its documents, and goes on from them', async () => {
    const { sql, files, write } = await created()
    value(
      await write({
        type: 'draft',
        changes: [{ kind: 'edit', id: 'b3', source: 'The quick red fox.', was: 'The quick brown fox.' }],
      }),
    )
    // woken again: nothing in memory
    const again = new IdeaService('idea-1', { sql, files, core: inProcessCore(), limits: DEFAULT_LIMITS })
    const draft = await again.draft()
    expect(draft.changes).toMatchObject([{ key: 'e-b3', change: { kind: 'edit', id: 'b3' }, by: OWNER }])
    const edit = { kind: 'edit', id: 'b5', source: 'It may pour.', was: 'It might rain.' }
    expect(
      (await again.write({ key: 'w1', caller: REVIEWER, write: { type: 'draft', changes: [edit] } })).result,
    ).toEqual({ ok: true, value: { kind: 'draft', keys: ['e-b5'] } })
    const now = await again.draft()
    expect(now.changes.map((c) => [c.key, c.by.user])).toEqual([
      ['e-b3', 'riley'],
      ['e-b5', 'maya'],
    ])
    expect(now.files[0]!.content).toBe('# Plan\n\nThe quick red fox.\n\n## Risks\n\nIt may pour.\n')
  })

  test('committed, its documents are the new version, and stay', async () => {
    const { sql, service, write } = await created()
    value(
      await write({
        type: 'draft',
        changes: [{ kind: 'edit', id: 'b3', source: 'The quick red fox.', was: 'The quick brown fox.' }],
      }),
    )
    const [before] = await sql.execute<{ steps: number }>('SELECT steps FROM draft_files')
    value(await write({ type: 'commit' }))
    const [after] = await sql.execute<{ steps: number; source: string }>('SELECT steps, source FROM draft_files')
    // the same document, now on v2: no steps were needed
    expect(after).toEqual({ steps: before!.steps, source: (await service.file(2, 'f1'))!.content })
    expect((await service.draft()).changes).toEqual([])
    expect(await sql.execute('SELECT * FROM draft_authors')).toEqual([])
  })

  test('a suggestion whose text the draft has changed is left out, saying why', async () => {
    const { write } = await created()
    value(await write({ type: 'suggest', version: 1, anchor: RAIN, new: 'may pour', body: '' }, REVIEWER))
    value(await write({ type: 'draft', changes: [{ kind: 'delete', id: 'b5', was: 'It might rain.' }] }))
    expect(await write({ type: 'accept', suggestions: ['c1'] })).toMatchObject({
      ok: false,
      error: { code: 'conflict', details: { skipped: [{ id: 'c1', message: 'its text is gone' }] } },
    })
  })
})

describe('status and reviews', () => {
  const BOT: Caller = { user: 'maya', bot: 'checkbot', purpose: 'bot-for-me' }
  const OTHER: Caller = { user: 'sam', bot: null, purpose: 'me' }
  const edit = (base: number) => ({
    type: 'edit',
    batch: { base, steps: [{ command: 'replace', in: 'b3', old: 'quick', new: `quick${base}` }] },
  })

  test('people move an open idea between statuses, with its history kept', async () => {
    const { service, write } = await created()
    expect(value(await write({ type: 'status', status: 'requesting-review', note: 'ready' }))).toEqual({
      kind: 'status',
      status: 'requesting-review',
      from: 'draft',
    })
    // the same status again changes nothing
    value(await write({ type: 'status', status: 'requesting-review' }))
    value(await write({ type: 'status', status: 'changes-in-progress' }, REVIEWER))
    const { status, history } = await service.reviews()
    expect(status).toBe('changes-in-progress')
    expect(history.map((h) => [h.status, h.by.user, h.note])).toEqual([
      ['draft', 'riley', ''],
      ['requesting-review', 'riley', 'ready'],
      ['changes-in-progress', 'maya', ''],
    ])
    expect((await service.summary())!.status).toBe('changes-in-progress')
  })

  test('an idea can be created out for review', async () => {
    const s = await setup()
    value(
      await s.write({
        type: 'create',
        title: 'Plan',
        status: 'requesting-review',
        files: [{ path: 'plan.md', content: PLAN }],
      }),
    )
    expect((await s.service.reviews()).history.map((h) => h.status)).toEqual(['requesting-review'])
  })

  test('a verdict is on the latest version; approvals count only there, and only from people', async () => {
    const { service, write } = await created()
    expect(await write({ type: 'review', version: 1, verdict: 'approve' })).toMatchObject({
      ok: false,
      error: { code: 'invalid', message: "you can't review your own idea" },
    })
    const approved = value(
      await write({ type: 'review', version: 1, verdict: 'approve', body: 'Looks good' }, REVIEWER),
    )
    expect(approved).toMatchObject({
      kind: 'review',
      review: { reviewer: 'u:maya', verdict: 'approve', version: 1, body: 'Looks good', counts: true, standing: false },
    })
    value(await write({ type: 'review', version: 1, verdict: 'approve' }, BOT))
    let reviews = (await service.reviews()).reviews
    expect(reviews.map((r) => [r.reviewer, r.counts])).toEqual([
      ['u:maya', true],
      // a bot acting for maya is its own reviewer, and its approval never counts
      ['b:maya:checkbot', false],
    ])

    value(await write(edit(1)))
    expect(await write({ type: 'review', version: 1, verdict: 'approve' }, OTHER)).toMatchObject({
      ok: false,
      error: { code: 'stale_version', details: { latest: 2 } },
    })
    reviews = (await service.reviews()).reviews
    // still shown, on v1, but no longer counting
    expect(reviews[0]).toMatchObject({ reviewer: 'u:maya', version: 1, counts: false })
  })

  test('an objection stands through new versions until it is withdrawn or dismissed, and blocks accepting', async () => {
    const { service, write } = await created()
    value(await write({ type: 'review', version: 1, verdict: 'request-changes', body: 'Name the risks' }, REVIEWER))
    value(await write({ type: 'review', version: 1, verdict: 'reject' }, BOT))
    value(await write(edit(1)))
    // a verdict never moves the status
    expect((await service.reviews()).status).toBe('draft')

    const blocked = await write({ type: 'close', reason: 'accepted' })
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: 'blocked', message: expect.stringContaining('2 reviewers object') },
    })
    expect((blocked as { error: { details: { objections: unknown[] } } }).error.details.objections).toHaveLength(2)

    // maya approves the new version, which withdraws her objection
    value(await write({ type: 'review', version: 2, verdict: 'approve' }, REVIEWER))
    // the bot's is dismissed by someone with edit access
    expect(await write({ type: 'dismiss', reviewer: 'u:maya', reason: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'invalid', message: 'only a Request changes or a Reject can be dismissed' },
    })
    const dismissed = value(await write({ type: 'dismiss', reviewer: 'b:maya:checkbot', reason: 'it misread v1' }))
    expect(dismissed).toMatchObject({
      review: { verdict: 'reject', standing: false, dismissed: { by: OWNER, reason: 'it misread v1' } },
    })
    expect(value(await write({ type: 'close', reason: 'accepted', note: 'going ahead' }))).toEqual({
      kind: 'status',
      status: 'closed-accepted',
      from: 'draft',
    })
  })

  test('a closed idea takes no status changes or verdicts until it is reopened, in the status it had', async () => {
    const { service, write } = await created()
    value(await write({ type: 'status', status: 'changes-in-progress' }))
    value(await write({ type: 'close', reason: 'rejected' }))
    expect(await write({ type: 'status', status: 'draft' })).toMatchObject({
      ok: false,
      error: { message: "it's closed rejected; reopen it first" },
    })
    expect(await write({ type: 'review', version: 1, verdict: 'approve' }, REVIEWER)).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    })
    expect(await write({ type: 'close', reason: 'accepted' })).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(value(await write({ type: 'reopen' }))).toEqual({
      kind: 'status',
      status: 'changes-in-progress',
      from: 'closed-rejected',
    })
    expect(await write({ type: 'reopen' })).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect((await service.reviews()).history.map((h) => h.status)).toEqual([
      'draft',
      'changes-in-progress',
      'closed-rejected',
      'changes-in-progress',
    ])
  })
})

describe('versions seen', () => {
  test('a person’s latest is kept, quietly; a bot’s reading isn’t', async () => {
    const { service, write } = await created()
    await write({ type: 'edit', batch: { base: 1, steps: [{ command: 'delete', target: 'b3' }] } })
    const outbox = await service.outboxSize()
    expect(await write({ type: 'seen', version: 1 }, REVIEWER)).toEqual({
      ok: true,
      value: { kind: 'seen', version: 1 },
    })
    expect(await write({ type: 'seen', version: 2 }, REVIEWER)).toEqual({
      ok: true,
      value: { kind: 'seen', version: 2 },
    })
    expect(await write({ type: 'seen', version: 1 }, REVIEWER)).toEqual({
      ok: true,
      value: { kind: 'seen', version: 2 },
    })
    const bot: Caller = { user: 'riley', bot: 'checkbot', purpose: 'bot-for-me' }
    expect(await write({ type: 'seen', version: 2 }, bot)).toEqual({ ok: true, value: { kind: 'seen', version: null } })
    expect(await write({ type: 'seen', version: 3 }, REVIEWER)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    })
    expect((await service.reviews()).seen).toEqual([{ user: 'maya', version: 2, at: expect.any(Number) }])
    // it's not a write anyone hears about
    expect(await service.outboxSize()).toBe(outbox)
  })
})

describe('pending reviews', () => {
  const QUICK = { kind: 'text', file: 'f1', start: 5, end: 10 }
  const maya = 'u:maya'

  test('pending comments are their author’s alone until the review is submitted, then all go out at once', async () => {
    const { service, write } = await created()
    // the owner's comment goes out straight away
    value(await write({ type: 'comment', version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'Context' }))
    const pending = await service.write({
      key: 'p1',
      caller: REVIEWER,
      write: { type: 'comment', version: 1, anchor: QUICK, body: 'Which fox?', pending: true },
    })
    // no event: nobody else hears of it
    expect(pending).toEqual({ result: { ok: true, value: { kind: 'comment', comment: 'c2' } }, events: [] })
    value(await write({ type: 'suggest', version: 1, anchor: QUICK, new: 'slow', body: '', pending: true }, REVIEWER))
    value(await write({ type: 'reply', parent: 'c1', body: 'Agreed', pending: true }, REVIEWER))
    // a reply in her own pending thread is pending, asked or not
    value(await write({ type: 'reply', parent: 'c2', body: 'Or a wolf?' }, REVIEWER))

    expect((await service.comments(undefined, null)).map((t) => [t.id, t.replies.length])).toEqual([['c1', 0]])
    const hers = await service.comments(undefined, maya)
    expect(hers.map((t) => [t.id, t.pending, t.replies.map((r) => [r.id, r.pending])])).toEqual([
      ['c1', false, [['c4', true]]],
      ['c2', true, [['c5', true]]],
      ['c3', true, []],
    ])
    expect((await service.reviews(maya)).pending).toBe(4)
    expect(await service.openComments()).toBe(1)

    // nobody else can reply to it, resolve it, or accept the pending suggestion
    expect(await write({ type: 'reply', parent: 'c2', body: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    })
    expect(await write({ type: 'resolve', comment: 'c2', resolved: true })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    })
    expect(await write({ type: 'accept', suggestions: ['c3'] })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    })

    // submitted with a verdict: published together, a thread whole and a reply to a thread already out
    const submitted = await service.write({
      key: 's1',
      caller: REVIEWER,
      write: { type: 'review', version: 1, verdict: 'request-changes', body: 'A few things' },
    })
    expect(submitted.result).toMatchObject({
      ok: true,
      value: { kind: 'review', review: { verdict: 'request-changes' }, published: ['c2', 'c3', 'c4', 'c5'] },
    })
    expect(submitted.events.map((e) => [e.name, e.name === 'comment' ? e.payload.thread.id : ''])).toEqual([
      ['reply', ''],
      ['comment', 'c2'],
      ['comment', 'c3'],
      ['review', ''],
    ])
    expect((await service.comments(undefined, null)).map((t) => t.id)).toEqual(['c1', 'c2', 'c3'])
    expect((await service.reviews(maya)).pending).toBe(0)
    expect(await service.openComments()).toBe(3)
  })

  test('pending comments follow new versions, and can be changed or deleted until they go out', async () => {
    const { service, write } = await created()
    value(await write({ type: 'comment', version: 1, anchor: QUICK, body: 'Quick?', pending: true }, REVIEWER))
    value(
      await write(
        { type: 'comment', version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'Too short', pending: true },
        REVIEWER,
      ),
    )
    value(await write({ type: 'reply', parent: 'c2', body: 'Much too', pending: true }, REVIEWER))
    value(
      await write({
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'insert', at: { start: 'f1' }, markdown: 'Preface.' }] },
      }),
    )
    // it followed its text, past the new preface
    const [quick] = await service.comments(undefined, maya)
    expect(quick).toMatchObject({ id: 'c1', state: 'exact', anchor: { quote: 'The q', start: 14 } })

    value(await write({ type: 'amend', comment: 'c1', body: 'Why quick?' }, REVIEWER))
    expect(await write({ type: 'amend', comment: 'c1', body: 'mine' })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    })
    // a thread goes with its replies
    expect(value(await write({ type: 'drop', comment: 'c2' }, REVIEWER))).toEqual({
      kind: 'pending',
      comments: ['c2', 'c3'],
    })
    expect((await service.comments(undefined, maya)).map((t) => [t.id, t.body])).toEqual([['c1', 'Why quick?']])

    // submitting without a verdict needs something pending, and the latest version
    expect(await write({ type: 'review', version: 1 }, REVIEWER)).toMatchObject({
      ok: false,
      error: { code: 'stale_version' },
    })
    expect(await write({ type: 'review', version: 2, body: 'Summary' }, REVIEWER)).toMatchObject({
      ok: false,
      error: { message: 'a summary goes with a verdict: approve, request changes or reject' },
    })
    expect(value(await write({ type: 'review', version: 2 }, REVIEWER))).toEqual({
      kind: 'review',
      review: null,
      published: ['c1'],
    })
    expect(await write({ type: 'review', version: 2 }, REVIEWER)).toMatchObject({
      ok: false,
      error: { message: 'you have no pending comments to submit, and gave no verdict' },
    })
    expect(await write({ type: 'amend', comment: 'c1', body: 'later' }, REVIEWER)).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    })
  })

  test('discarding a review deletes every pending comment of yours', async () => {
    const { service, write } = await created()
    value(await write({ type: 'comment', version: 1, anchor: QUICK, body: 'a', pending: true }, REVIEWER))
    value(await write({ type: 'comment', version: 1, anchor: QUICK, body: 'b', pending: true }))
    expect(value(await write({ type: 'unreview' }, REVIEWER))).toEqual({ kind: 'pending', comments: ['c1'] })
    expect((await service.comments(undefined, 'u:riley')).map((t) => t.id)).toEqual(['c2'])
  })
})

describe('retries', () => {
  test('a write retried with the same key is applied once and returns the same result', async () => {
    const { service } = await created()
    const once = await service.write({
      key: 'same',
      caller: OWNER,
      write: { type: 'edit', batch: { base: 1, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'New.' }] } },
    })
    const again = await service.write({
      key: 'same',
      caller: OWNER,
      write: { type: 'edit', batch: { base: 1, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'New.' }] } },
    })
    expect(again.result).toEqual(once.result)
    expect(again.events).toEqual([])
    expect((await service.summary())!.latest).toBe(2)
  })

  test('the latest version survives a restart (a new service on the same storage)', async () => {
    const { sql, files, write } = await created()
    await write({
      type: 'edit',
      batch: { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'quick', new: 'slow' }] },
    })
    const restarted = new IdeaService('idea-1', { sql, files, core: inProcessCore(), limits: DEFAULT_LIMITS })
    expect((await restarted.file(undefined, 'f1'))!.content).toContain('The slow brown fox.')
    const next = await restarted.write({
      key: 'after-restart',
      caller: OWNER,
      write: { type: 'edit', batch: { base: 2, steps: [{ command: 'replace', in: 'b3', old: 'slow', new: 'fast' }] } },
    })
    expect(next.result).toMatchObject({ ok: true, value: { version: 3 } })
  })
})

describe('the outbox', () => {
  // what each write tells the directory, written in its own transaction
  const outbox = async (sql: Awaited<ReturnType<typeof setup>>['sql']) =>
    (await sql.execute<{ id: string; events: string }>('SELECT id, events FROM outbox ORDER BY at, id')).map((r) =>
      (JSON.parse(r.events) as Array<{ kind: string; detail: Record<string, unknown> }>).map((e) => e.kind),
    )

  test('holds what each write tells inboxes; nothing for a refusal, a repeat, or what tells no one', async () => {
    const { sql, write } = await created()
    expect(await outbox(sql)).toEqual([['version']])
    // refused, and the same write again: nothing more
    expect((await write({ type: 'status', status: 'nonsense' })).ok).toBe(false)
    value(await write({ type: 'status', status: 'requesting-review' }, OWNER, 'same'))
    value(await write({ type: 'status', status: 'requesting-review' }, OWNER, 'same'))
    const c = value(
      await write({
        type: 'comment',
        version: 1,
        anchor: { kind: 'text', file: 'f1', start: 15, end: 20 },
        body: 'Which?',
      }),
    ) as { comment: string }
    value(await write({ type: 'reply', parent: c.comment, body: 'The brown one.' }, REVIEWER))
    // resolving tells no one
    value(await write({ type: 'resolve', comment: c.comment, resolved: true }))
    expect(await outbox(sql)).toEqual([['version'], ['status'], ['comment'], ['reply']])
    const [, , comment] = (await sql.execute<{ events: string }>('SELECT events FROM outbox ORDER BY at, id')).map(
      (r) => JSON.parse(r.events) as Array<{ detail: Record<string, unknown> }>,
    )
    expect(comment![0]!.detail).toMatchObject({ comment: c.comment, quote: 'brown', body: 'Which?' })
  })

  test('a pending comment tells no one until its review is submitted, then with the verdict', async () => {
    const { sql, write } = await created()
    value(
      await write(
        { type: 'comment', version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'Later', pending: true },
        REVIEWER,
      ),
    )
    expect(await outbox(sql)).toEqual([['version']])
    value(await write({ type: 'review', version: 1, verdict: 'request-changes' }, REVIEWER))
    expect(await outbox(sql)).toEqual([['version'], ['comment', 'review']])
  })

  test('is sent oldest first; one the directory couldn’t take waits longer each time', async () => {
    const { service, write } = await created()
    value(await write({ type: 'status', status: 'requesting-review' }))
    const [first, second] = await service.outboxDue()
    expect(first!.events.map((e) => e.kind)).toEqual(['version'])
    await service.outboxSent(first!.id)
    await service.outboxFailed(second!.id, 0)
    expect(await service.outboxDue()).toEqual([])
    const next = (await service.outboxNextAt())!
    await service.outboxFailed(second!.id, 3)
    expect((await service.outboxNextAt())! - next).toBeGreaterThan(3_000)
    await service.outboxSent(second!.id)
    expect(await service.outboxNextAt()).toBeNull()
  })
})
