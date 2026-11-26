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
  /** Time passing, as the service sees it. */
  const wait = (minutes: number) => {
    clock += minutes * 60_000
  }
  return { sql, files, service, write, wait }
}

async function created(limits: Limits = DEFAULT_LIMITS) {
  const s = await setup(limits)
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
      { number: 1, parent: null, createdAt: expect.any(Number), by: OWNER, how: 'created', steps: 0, authors: [OWNER] },
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
        authors: [OWNER],
      },
      { step: 1, command: { command: 'move', target: 's4', to: { start: 'f1' } }, addresses: [], authors: [OWNER] },
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
  const small: Limits = { ...DEFAULT_LIMITS, maxFileBytes: 100, maxIdeaBytes: 150 }

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

  test('is on the latest version: a version made over its changes overwrites them, once confirmed', async () => {
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
    // an agent's batch changes the fox too: refused, naming the draft's change, until it confirms
    const batch = { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'quick', new: 'slow' }] }
    expect(await write({ type: 'edit', batch })).toMatchObject({
      ok: false,
      error: {
        code: 'draft_outdated',
        message:
          'this version changes what a change in the draft also changed: resolve it against the draft and send it as changes to the draft, or confirm to overwrite it',
        details: { changes: [{ key: (stale as { keys: string[] }).keys[0], by: OWNER }] },
      },
    })
    expect((await service.summary())!.latest).toBe(1)
    // confirmed, a force push: the draft's fox is overwritten with the version's, and the other change stays
    const made = await service.write({
      key: 'force',
      caller: OWNER,
      write: { type: 'edit', batch, overwriteDraft: true },
    })
    expect(made.events.find((e) => e.name === 'version')!.payload).toMatchObject({ version: 2, overwrote: 1 })
    const draft = await service.draft()
    expect(draft.version).toBe(2)
    expect(draft.changes.map((c) => [c.key, c.problem])).toEqual([['e-b5', null]])
    expect(draft.files[0]!.content).toBe('# Plan\n\nThe slow brown fox.\n\n## Risks\n\nIt may pour.\n')
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

describe('restore points', () => {
  const FOX = { kind: 'edit', id: 'b3', source: 'The quick red fox.', was: 'The quick brown fox.' } as const
  const RAIN = { kind: 'edit', id: 'b5', source: 'It may pour.', was: 'It might rain.' } as const
  const REDFOX = '# Plan\n\nThe quick red fox.\n\n## Risks\n\nIt may pour.\n'
  const ZOE: Caller = { user: 'zoe', bot: null, purpose: 'me' }
  const AGENT: Caller = { user: 'riley', bot: 'checkbot', purpose: 'bot-for-me' }

  test('a discard keeps one, and restoring it brings the draft back for everyone, with who made each change', async () => {
    const { service, write } = await created()
    value(await write({ type: 'draft', changes: [FOX] }, REVIEWER))
    value(
      await write(
        {
          type: 'suggest',
          version: 1,
          anchor: { kind: 'text', file: 'f1', start: 35, end: 45 },
          new: 'may pour',
          body: '',
        },
        REVIEWER,
      ),
    )
    value(await write({ type: 'accept', suggestions: ['c1'] }))
    const discarded = await service.write({ key: 'discard', caller: OWNER, write: { type: 'discard' } })
    expect(discarded.result).toEqual({ ok: true, value: { kind: 'discarded', point: 1 } })
    expect(discarded.events.find((e) => e.name === 'draft')!.payload).toEqual({
      by: OWNER,
      discarded: { point: 1 },
    })
    // the list of them changed too
    expect(discarded.events.at(-1)).toEqual({ name: 'restorePoints', payload: { by: OWNER } })
    const [point] = await service.restorePoints()
    expect(point).toMatchObject({ point: 1, version: 1, why: 'discard', by: OWNER, changes: 2, more: 1, kept: true })
    expect(point!.who.map((c) => c.user).sort()).toEqual(['maya', 'riley'])
    expect((await service.draft()).changes).toEqual([])

    const restored = await service.write({ key: 'restore', caller: OWNER, write: { type: 'restore', point: 1 } })
    expect(restored.result).toEqual({ ok: true, value: { kind: 'draft', keys: [] } })
    // everyone editing gets the steps, and is told
    expect(restored.events.map((e) => e.name)).toEqual(['draftSteps', 'draft'])
    expect(restored.events.at(-1)!.payload).toEqual({ by: OWNER, restored: true })
    const draft = await service.draft()
    expect(draft.files[0]!.content).toBe(REDFOX)
    // the fox is still Maya's, and the suggestion is in the draft again
    expect(draft.changes.map((c) => [c.change.kind, c.by.user])).toEqual([
      ['suggestion', 'riley'],
      ['edit', 'maya'],
    ])
    expect((await service.comments())[0]).toMatchObject({ suggestion: { inDraft: true, decision: null } })
    // an empty draft keeps no restore point of itself
    expect((await service.restorePoints()).map((p) => p.why)).toEqual(['discard'])
    expect(await write({ type: 'restore', point: 9 })).toMatchObject({ ok: false, error: { code: 'not_found' } })
  })

  test('restoring keeps the draft as it was first, so a restore can be taken back', async () => {
    const { service, write } = await created()
    value(await write({ type: 'draft', changes: [FOX] }))
    value(await write({ type: 'discard' }))
    value(await write({ type: 'draft', changes: [RAIN] }))
    value(await write({ type: 'restore', point: 1 }))
    expect((await service.draft()).files[0]!.content).toBe(
      '# Plan\n\nThe quick red fox.\n\n## Risks\n\nIt might rain.\n',
    )
    expect((await service.restorePoints()).map((p) => [p.point, p.why, p.changes])).toEqual([
      [2, 'restore', 1],
      [1, 'discard', 1],
    ])
    value(await write({ type: 'restore', point: 2 }))
    expect((await service.draft()).files[0]!.content).toBe(
      '# Plan\n\nThe quick brown fox.\n\n## Risks\n\nIt may pour.\n',
    )
  })

  test('one is kept once the draft has been quiet five minutes, labelled with who changed what since the one before', async () => {
    const { service, write, wait } = await created()
    // nothing changed yet: nothing to wait for
    expect(await service.quietPoint()).toEqual({ point: null, due: null, events: [] })
    value(await write({ type: 'draft', changes: [FOX] }))
    // not quiet long enough: when to look again
    const early = await service.quietPoint()
    expect(early.point).toBeNull()
    expect(early.due).toBeGreaterThan(4 * 60_000)
    wait(5)
    const quiet = await service.quietPoint()
    expect(quiet.due).toBeNull()
    expect(quiet.events).toEqual([{ name: 'restorePoints', payload: { by: null } }])
    expect(await service.restorePoints()).toEqual([
      {
        point: 1,
        version: 1,
        why: 'quiet',
        by: null,
        at: expect.any(Number),
        changes: 1,
        who: [OWNER],
        first: FOX,
        more: 0,
        undone: 0,
        kept: true,
      },
    ])
    // nothing's changed since: none more
    wait(5)
    expect((await service.quietPoint()).point).toBeNull()
    // Maya edits the rain and takes back the fox: the next is hers, and says one is gone
    value(await write({ type: 'draft', changes: [RAIN] }, REVIEWER))
    const [fox] = (await service.draft()).changes.filter((c) => c.change.kind === 'edit' && c.change.id === 'b3')
    value(await write({ type: 'undraft', key: fox!.key }, REVIEWER))
    wait(5)
    await service.quietPoint()
    expect((await service.restorePoints())[0]).toMatchObject({
      point: 2,
      why: 'quiet',
      changes: 1,
      who: [REVIEWER],
      first: RAIN,
      more: 0,
      undone: 1,
    })
  })

  test('one is kept when someone who changed the draft leaves it, unless it has one of it already', async () => {
    const { service, write } = await created()
    value(await write({ type: 'draft', changes: [FOX] }, REVIEWER))
    expect(await service.leftPoint(REVIEWER)).toEqual([{ name: 'restorePoints', payload: { by: REVIEWER } }])
    expect(await service.leftPoint(OWNER)).toEqual([])
    expect((await service.restorePoints()).map((p) => [p.why, p.by?.user])).toEqual([['left', 'maya']])
  })

  test('one is kept before an agent changes the draft, unless it changed it last', async () => {
    const { service, write } = await created()
    value(await write({ type: 'draft', changes: [FOX] }))
    const first = await service.write({ key: 'a1', caller: AGENT, write: { type: 'draft', changes: [RAIN] } })
    expect(first.events.at(-1)).toEqual({ name: 'restorePoints', payload: { by: AGENT } })
    // its next change: the draft before it is the agent's own, kept already
    value(
      await write(
        { type: 'draft', changes: [{ kind: 'insert', at: { after: 'b3' }, markdown: 'Bring the list.' }] },
        AGENT,
      ),
    )
    expect((await service.restorePoints()).map((p) => [p.why, p.by, p.changes])).toEqual([['agent', AGENT, 1]])
    // someone else changes it in between: the agent's next change keeps one again
    value(
      await write({ type: 'draft', changes: [{ ...FOX, source: 'The quick tan fox.', was: 'The quick red fox.' }] }),
    )
    value(
      await write(
        { type: 'draft', changes: [{ kind: 'insert', at: { after: 'b5' }, markdown: 'Call the depot.' }] },
        AGENT,
      ),
    )
    expect((await service.restorePoints()).map((p) => p.why)).toEqual(['agent', 'agent'])
  })

  test('never two of the same draft: one before a discard takes over the quiet one', async () => {
    const { service, write, wait } = await created()
    value(await write({ type: 'draft', changes: [FOX] }))
    wait(5)
    await service.quietPoint()
    expect(value(await write({ type: 'discard' }))).toEqual({ kind: 'discarded', point: 1 })
    expect((await service.restorePoints()).map((p) => [p.point, p.why, p.by])).toEqual([[1, 'discard', OWNER]])
  })

  test('one is kept before a version overwrites the draft', async () => {
    const { service, write } = await created()
    value(await write({ type: 'draft', changes: [FOX] }))
    const batch = { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'quick', new: 'slow' }] }
    value(await write({ type: 'edit', batch, overwriteDraft: true }))
    expect(await service.restorePoints()).toMatchObject([
      { point: 1, version: 1, why: 'overwrite', by: OWNER, changes: 1, first: FOX, kept: true },
    ])
  })

  test('restored on a later version, a change a version since has outdated comes back held, to undo or redo', async () => {
    const { service, write } = await created()
    value(await write({ type: 'draft', changes: [FOX, RAIN] }))
    value(await write({ type: 'discard' }))
    value(
      await write({
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'quick', new: 'slow' }] },
      }),
    )
    // shown first, without restoring: the files as it would make them, and one change held
    expect(await service.restorePoint(1)).toEqual({
      point: 1,
      files: [{ file: 'f1', path: 'plan.md', content: '# Plan\n\nThe slow brown fox.\n\n## Risks\n\nIt may pour.\n' }],
      held: 1,
    })
    expect((await service.draft()).changes).toEqual([])
    value(await write({ type: 'restore', point: 1 }))
    const draft = await service.draft()
    expect(draft.version).toBe(2)
    expect(draft.files[0]!.content).toBe('# Plan\n\nThe slow brown fox.\n\n## Risks\n\nIt may pour.\n')
    expect(draft.changes.map((c) => [c.change.kind === 'edit' && c.change.id, c.problem !== null])).toEqual([
      ['b3', true],
      ['b5', false],
    ])
  })

  test('versions made since leave them be', async () => {
    const { service, write } = await created()
    value(await write({ type: 'draft', changes: [FOX] }))
    value(await write({ type: 'discard' }))
    for (const change of [FOX, RAIN]) {
      value(await write({ type: 'draft', changes: [change] }))
      value(await write({ type: 'commit' }))
    }
    expect((await service.restorePoints()).map((p) => [p.point, p.version, p.kept])).toEqual([[1, 1, true]])
    value(await write({ type: 'restore', point: 1 }))
  })

  test('past the room for them, the oldest are dropped: their labels stay, and they can no longer be restored', async () => {
    // room for less than one: only the latest is kept
    const { service, write } = await created({
      ...DEFAULT_LIMITS,
      draft: { ...DEFAULT_LIMITS.draft, restoreKeepMb: 1e-6 },
    })
    for (const change of [FOX, RAIN, FOX]) {
      value(await write({ type: 'draft', changes: [change] }))
      value(await write({ type: 'discard' }))
    }
    expect((await service.restorePoints()).map((p) => [p.point, p.kept, p.first])).toEqual([
      [3, true, FOX],
      [2, false, RAIN],
      [1, false, FOX],
    ])
    expect(await write({ type: 'restore', point: 2 })).toMatchObject({
      ok: false,
      error: { code: 'not_found', message: expect.stringContaining('no longer kept') },
    })
  })

  test('the idea’s owner, or someone who made one of its changes, can delete one, label and all', async () => {
    const { service, write } = await created()
    value(await write({ type: 'draft', changes: [FOX] }, REVIEWER))
    value(await write({ type: 'discard' }))
    value(await write({ type: 'draft', changes: [RAIN] }, REVIEWER))
    value(await write({ type: 'discard' }))
    expect(await write({ type: 'deleteRestorePoint', point: 1 }, ZOE)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
    const deleted = await service.write({ key: 'd', caller: REVIEWER, write: { type: 'deleteRestorePoint', point: 1 } })
    expect(deleted).toEqual({
      result: { ok: true, value: { kind: 'deleted', point: 1 } },
      events: [{ name: 'restorePoints', payload: { by: REVIEWER } }],
    })
    expect(value(await write({ type: 'deleteRestorePoint', point: 2 }))).toEqual({ kind: 'deleted', point: 2 })
    expect(await service.restorePoints()).toEqual([])
    expect(await write({ type: 'deleteRestorePoint', point: 2 })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    })
  })
})

describe('typing in the draft', () => {
  // f1: s2 "Plan" at 0, b3 "The quick brown fox." at 6 (its text from 7), s4, b5

  type Typed = import('@ideaf/ui/editor/model').Transform & {
    insertText: (text: string, from: number, to?: number) => unknown
  }

  /** An editor of f1, as the page editor is: the document the server sent, and steps typed on it. */
  async function editor(service: IdeaService, client = 'c1', caller: Caller = OWNER) {
    const { pageDocument, Transform } = await import('@ideaf/ui/editor/model')
    const { schema } = await pageDocument(PLAN, [])
    const opened = (await service.openDraftFile('f1'))!
    let doc = schema.nodeFromJSON(opened.doc)
    let version = opened.version
    return {
      get doc() {
        return doc
      },
      get version() {
        return version
      },
      /** Typed and sent, on the count this editor has (or `on`); taken, it has what the server sent back. */
      async type(edit: (tr: Typed) => void, on = version) {
        const tr = new Transform(doc)
        const typed = Object.assign(tr, {
          insertText: (text: string, from: number, to = from) => tr.replaceWith(from, to, schema.text(text)),
        })
        edit(typed)
        const sent = await service.typing({
          file: 'f1',
          version: on,
          steps: tr.steps.map((s) => s.toJSON()),
          client,
          caller,
        })
        if (sent.result.kind === 'taken') {
          const event = sent.events.find((e) => e.name === 'draftSteps' && e.payload.file === 'f1')!
          const { Step } = await import('@ideaf/ui/editor/model')
          for (const json of (event.payload as { steps: unknown[] }).steps) {
            doc = Step.fromJSON(schema, json).apply(doc).doc!
          }
          version = sent.result.version
        }
        return sent
      },
      /** Takes in steps the server sent: from its count. */
      async take(payload: { from: number; steps: unknown[] }) {
        const { Step } = await import('@ideaf/ui/editor/model')
        for (const json of payload.steps.slice(version - payload.from)) {
          doc = Step.fromJSON(schema, json).apply(doc).doc!
        }
        version = Math.max(version, payload.from + payload.steps.length)
      },
    }
  }

  test('is stored as it comes, and is a change of the draft by whoever typed it', async () => {
    const { sql, service } = await created()
    const ana = await editor(service)
    expect(ana.version).toBe(0)
    const sent = await ana.type((tr) => tr.insertText('red', 17, 22))
    expect(sent.result).toEqual({ kind: 'taken', version: 1 })
    expect(sent.events).toMatchObject([{ name: 'draftSteps', payload: { file: 'f1', from: 0, clients: ['c1'] } }])
    const draft = await service.draft()
    expect(draft.changes).toMatchObject([{ key: 'e-b3', by: OWNER, change: { source: 'The quick red fox.' } }])
    expect(await sql.execute('SELECT seq, client FROM draft_steps')).toEqual([{ seq: 1, client: 'c1' }])
  })

  test('typing keeps no restore point itself: once it has been quiet a while, the alarm keeps one of it as typed', async () => {
    const { service, wait } = await created()
    const ana = await editor(service)
    await ana.type((tr) => tr.insertText('red', 17, 22))
    await ana.type((tr) => tr.insertText('!', 20))
    expect(await service.restorePoints()).toEqual([])
    wait(5)
    expect((await service.quietPoint()).due).toBeNull()
    await ana.type((tr) => tr.insertText('?', 21))
    expect(await service.restorePoints()).toMatchObject([{ point: 1, why: 'quiet', changes: 1 }])
    value(await service.write({ key: 'r', caller: OWNER, write: { type: 'restore', point: 1 } }).then((w) => w.result))
    expect((await service.draft()).files[0]!.content).toContain('The quick red! fox.')
  })

  test('steps on an older count are behind: the editor takes what it missed, and sends again', async () => {
    const { service } = await created()
    const ana = await editor(service, 'ana')
    const raj = await editor(service, 'raj', REVIEWER)
    const first = await ana.type((tr) => tr.insertText('red', 17, 22))
    // after the rain (b5's text is 36 to 50)
    expect((await raj.type((tr) => tr.insertText(' Soon.', 50))).result).toEqual({ kind: 'behind', version: 1 })
    await raj.take(first.events[0]!.payload as { from: number; steps: unknown[] })
    // replayed on what it missed: the same place, past Ana's shorter word
    expect((await raj.type((tr) => tr.insertText(' Soon.', 48))).result).toEqual({ kind: 'taken', version: 2 })
    const draft = await service.draft()
    expect(draft.files[0]!.content).toBe('# Plan\n\nThe quick red fox.\n\n## Risks\n\nIt might rain. Soon.\n')
    expect(draft.changes.map((c) => [c.key, c.by.user])).toEqual([
      ['e-b3', 'riley'],
      ['e-b5', 'maya'],
    ])
  })

  test('a change is everyone who typed in it, and committing credits each step and the version to them', async () => {
    const { service, sql, write } = await created()
    const ana = await editor(service, 'ana')
    const raj = await editor(service, 'raj', REVIEWER)
    const first = await ana.type((tr) => tr.insertText('red', 17, 22))
    await raj.take(first.events[0]!.payload as { from: number; steps: unknown[] })
    // Raj adds to Ana's paragraph, then to the last one: "It might rain." is 34 to 48 now
    await raj.type((tr) => tr.insertText(' Soon.', 48))
    await raj.type((tr) => tr.insertText(' Indeed.', 25))
    const draft = await service.draft()
    expect(draft.changes.map((c) => [c.key, c.by.user, c.authors.map((a) => a.user)])).toEqual([
      ['e-b3', 'maya', ['maya', 'riley']],
      ['e-b5', 'maya', ['maya']],
    ])

    // Ana commits: the version is hers, and what's in it is everyone's who typed it
    const committed = value(await write({ type: 'commit' }))
    expect(committed).toMatchObject({ kind: 'version', version: 2 })
    const steps = (committed as { steps: Array<{ authors: Caller[] }> }).steps
    expect(steps.map((s) => s.authors)).toEqual([[REVIEWER, OWNER], [REVIEWER]])
    expect((await service.steps(2)).map((s) => s.authors)).toEqual([[REVIEWER, OWNER], [REVIEWER]])
    const v2 = (await service.summary())!.versions.at(-1)!
    expect(v2).toMatchObject({ number: 2, by: OWNER, authors: [REVIEWER, OWNER] })
    // the draft starts again from it, with nobody's typing in it
    expect(await sql.execute('SELECT * FROM draft_authors')).toEqual([])
  })

  test('behind is answered from the document held, as it would be in its turn', async () => {
    const { service, sql, files } = await created()
    expect(service.behind('f1', 0)).toBeNull()
    const ana = await editor(service, 'ana')
    await ana.type((tr) => tr.insertText('red', 17, 22))
    expect(service.behind('f1', 1)).toBeNull()
    expect(service.behind('f1', 0)).toBe(1)
    expect(service.behind('f2', 0)).toBeNull()
    // the same answer from a service that holds nothing yet, which reads the draft in its turn
    const fresh = new IdeaService('idea-1', { sql, files, core: inProcessCore(), limits: DEFAULT_LIMITS })
    expect(fresh.behind('f1', 0)).toBeNull()
    const sent = { file: 'f1', version: 0, steps: [], client: 'raj', caller: REVIEWER }
    expect((await fresh.typing(sent)).result).toEqual({ kind: 'behind', version: 1 })
    expect((await service.typing(sent)).result).toEqual({ kind: 'behind', version: 1 })
  })

  test('a file a new version doesn’t have isn’t held: typing in it is refused, not told it’s behind', async () => {
    const { service, write } = await created()
    value(
      await write({
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'create-file', path: 'notes.md', markdown: 'Hi.' }] },
      }),
    )
    const ana = await editor(service, 'ana')
    await ana.type((tr) => tr.insertText('red', 17, 22))
    const gone = { base: 2, steps: [{ command: 'delete-file', file: 'f1' }] }
    value(await write({ type: 'edit', batch: gone, overwriteDraft: true }))
    expect(service.behind('f1', 0)).toBeNull()
    const sent = { file: 'f1', version: 0, steps: [], client: 'raj', caller: REVIEWER }
    expect((await service.typing(sent)).result).toEqual({
      kind: 'refused',
      message: 'the latest version has no such file',
    })
  })

  test('a paragraph split in two: the new one takes the ID committing gives it, from the server', async () => {
    const { service } = await created()
    const ana = await editor(service)
    // Enter after "quick ": both halves have b3, as ProseMirror splits them
    const sent = await ana.type((tr) => tr.split(17))
    expect(sent.result).toEqual({ kind: 'taken', version: 2 })
    expect(sent.events[0]!.payload).toMatchObject({ clients: ['c1', 'server'] })
    const { holders } = await import('@ideaf/ui/editor/model')
    const draft = await service.draft()
    // the editor's IDs are the draft's, each once, the new one as committing would number it
    const ids = draft.files[0]!.units.map((u) => u.id)
    expect(holders(ana.doc).map((h) => h.id)).toEqual(ids)
    expect([...ids].sort()).toEqual(['b3', 'b5', 'b6', 's2', 's4'])
    expect(draft.files[0]!.units.map((u) => u.source.trim())).toEqual([
      '# Plan',
      'The quick',
      'brown fox.',
      '## Risks',
      'It might rain.',
    ])
  })

  test('what an editor missed comes from its count; from too long ago, it’s gone', async () => {
    const { sql, service } = await created()
    const ana = await editor(service)
    await ana.type((tr) => tr.insertText('red', 17, 22))
    await ana.type((tr) => tr.insertText('!', 22))
    expect(await service.draftSince('f1', 1)).toMatchObject({ kind: 'steps', from: 1, clients: ['c1'] })
    expect(await service.draftSince('f1', 2)).toEqual({ kind: 'steps', from: 2, steps: [], clients: [], by: [] })
    await sql.execute('DELETE FROM draft_steps WHERE seq = 1')
    expect(await service.draftSince('f1', 0)).toEqual({ kind: 'gone' })
  })

  test('another write changes only the blocks it changes: typing elsewhere stays as it is', async () => {
    const { service, write } = await created()
    const ana = await editor(service)
    // a space typed at the end of the fox (its text is 7 to 27): Markdown has no way to keep it, the
    // document does
    await ana.type((tr) => tr.insertText(' ', 27))
    const before = ana.version
    const changed = await service.write({
      key: 'agent',
      caller: REVIEWER,
      write: { type: 'draft', changes: [{ kind: 'edit', id: 'b5', source: 'It may pour.', was: 'It might rain.' }] },
    })
    value(changed.result)
    const steps = changed.events.find((e) => e.name === 'draftSteps')!
    await ana.take(steps.payload as { from: number; steps: unknown[] })
    expect(ana.version).toBeGreaterThan(before)
    expect(ana.doc.child(1).textContent).toBe('The quick brown fox. ')
    expect(ana.doc.child(3).textContent).toBe('It may pour.')
    void write
  })

  test('an agent’s change reaches editors as its steps, so they can mark it; typing is a window’s', async () => {
    const { service } = await created()
    const ana = await editor(service)
    await ana.type((tr) => tr.insertText('red', 17, 22))
    const agent: Caller = { user: 'maya', bot: 'checkbot', purpose: 'bot-for-me' }
    const changed = await service.write({
      key: 'agent',
      caller: agent,
      write: { type: 'draft', changes: [{ kind: 'edit', id: 'b5', source: 'It may pour.', was: 'It might rain.' }] },
    })
    value(changed.result)
    const sent = changed.events.find((e) => e.name === 'draftSteps')!.payload as { steps: unknown[]; by: unknown[] }
    expect(sent.steps.length).toBeGreaterThan(0)
    expect(sent.by).toEqual(sent.steps.map(() => agent))
    // and to an editor catching up: the typing is the window's, the change the agent's
    const missed = await service.draftSince('f1', 0)
    expect(missed).toMatchObject({ kind: 'steps', clients: ['c1', ...sent.steps.map(() => 'server')] })
    expect(missed.kind === 'steps' && missed.by).toEqual([null, ...sent.steps.map(() => agent)])
  })

  test('committed while someone types: the documents carry on, on the new version', async () => {
    const { service, write } = await created()
    const ana = await editor(service)
    await ana.type((tr) => tr.insertText('red', 17, 22))
    value(await write({ type: 'commit' }))
    expect((await service.file(2, 'f1'))!.content).toContain('quick red fox')
    expect((await service.draft()).changes).toEqual([])
    // typing goes on from where it was: it's the next version's
    expect((await ana.type((tr) => tr.insertText('!', 20))).result.kind).toBe('taken')
    expect((await service.draft()).changes).toMatchObject([{ key: 'e-b3', change: { source: 'The quick red! fox.' } }])
  })

  test('words seen moved to another paragraph are a move: their comment goes with them', async () => {
    const { service, write } = await created()
    // "brown" is at 15 to 20 in the plain text
    value(
      await write(
        { type: 'comment', version: 1, anchor: { kind: 'text', file: 'f1', start: 15, end: 20 }, body: 'Which brown?' },
        REVIEWER,
      ),
    )
    const ana = await editor(service)
    // " brown" cut from the fox (16 to 22), and pasted after the rain (b5's text ends at 50, 44 once cut)
    await ana.type((tr) => tr.delete(16, 22))
    await ana.type((tr) => tr.insertText(' brown', 44))
    const moved = { from: 'b3', old: ' brown', to: { in: 'b5', after: 'It might rain.' } }
    // without the note, it's two edits, and the comment's words are gone
    expect((await service.draft()).comments).toMatchObject([{ state: 'outdated' }])
    await service.movedWords(moved, OWNER)
    const draft = await service.draft()
    expect(draft.files[0]!.content).toBe('# Plan\n\nThe quick fox.\n\n## Risks\n\nIt might rain. brown\n')
    expect(draft.changes).toMatchObject([{ key: 't-b3-b5', change: { kind: 'move-text', old: ' brown' } }])
    expect(draft.comments[0]!.state).not.toBe('outdated')
    // committed, the comment is on its words in the new version
    value(await write({ type: 'commit' }))
    const [thread] = await service.comments(2)
    expect(thread).toMatchObject({ state: expect.not.stringMatching('outdated'), anchor: { quote: 'brown' } })
    // and the note's gone with the draft
    expect((await service.draft()).changes).toEqual([])
  })

  test('words moved next to text the draft has changed still move: placed by what the version has', async () => {
    const { service, write } = await created()
    value(
      await write(
        { type: 'comment', version: 1, anchor: { kind: 'text', file: 'f1', start: 15, end: 20 }, body: 'Which brown?' },
        REVIEWER,
      ),
    )
    const ana = await editor(service)
    // a space typed at the end of the rain first (its text ends at 50), then " brown" cut and pasted after it
    await ana.type((tr) => tr.insertText(' Soon', 50))
    await ana.type((tr) => tr.delete(16, 22))
    await ana.type((tr) => tr.insertText(' brown', 49))
    // as the editor saw it land: after the rain as the draft had it then
    await service.movedWords({ from: 'b3', old: ' brown', to: { in: 'b5', after: 'It might rain. Soon' } }, OWNER)
    const draft = await service.draft()
    expect(draft.files[0]!.content).toBe('# Plan\n\nThe quick fox.\n\n## Risks\n\nIt might rain. Soon brown\n')
    expect(draft.changes.map((c) => c.change.kind).sort()).toEqual(['edit', 'move-text'])
    expect(draft.comments[0]!.state).not.toBe('outdated')
  })

  test('a fresh actor has the same document: its snapshot and the steps after it', async () => {
    const { sql, files, service } = await created()
    const ana = await editor(service)
    await ana.type((tr) => tr.insertText('red', 17, 22))
    await ana.type((tr) => tr.insertText('!', 20))
    const again = new IdeaService('idea-1', { sql, files, core: inProcessCore(), limits: DEFAULT_LIMITS })
    const opened = (await again.openDraftFile('f1'))!
    expect(opened.version).toBe(ana.version)
    expect(opened.doc).toEqual(ana.doc.toJSON())
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
