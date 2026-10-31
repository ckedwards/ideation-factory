// IdeaService without Rivet: bun:sqlite in memory, an in-memory file store and
// core in process. The actor test covers the same flows through RivetKit.
import { describe, expect, test } from 'bun:test'
import { contentHash } from '@ideaf/core'
import { inProcessCore } from '../core-pool/runner.ts'
import { MemoryFileStore } from '../files/memory.ts'
import { DEFAULT_LIMITS, type Limits } from '../limits.ts'
import { migrate } from './schema.ts'
import { type Caller, IdeaService, type WriteResult } from './service.ts'
import { bunSql } from './sql-bun.ts'

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
  const write = async (write: unknown, caller: Caller = OWNER, key = `k${++n}`) => (await service.write({ key, caller, write })).result
  return { sql, files, service, write }
}

async function created() {
  const s = await setup()
  expect(await s.write({ type: 'create', title: 'Plan', files: [{ path: 'plan.md', content: PLAN }] })).toEqual({ ok: true, value: { kind: 'created', version: 1 } })
  return s
}

const value = (r: WriteResult) => {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`)
  return r.value
}

describe('creating an idea', () => {
  test('stores v1: its manifest in SQL, its contents in the file store by hash', async () => {
    const { service, files } = await created()
    const summary = await service.summary()
    expect(summary).toMatchObject({ id: 'idea-1', title: 'Plan', owner: 'riley', status: 'draft', latest: 1 })
    expect(summary!.versions).toEqual([{ number: 1, parent: null, createdAt: expect.any(Number), by: OWNER, how: 'created', steps: 0 }])
    const manifest = await service.files()
    expect(manifest).toEqual([{ file: 'f1', path: 'plan.md', hash: await contentHash(PLAN), bytes: PLAN.length }])
    expect(await files.has(manifest[0]!.hash)).toBe(true)
    expect((await service.file(1, 'f1'))!.content).toBe(PLAN)
    expect((await service.outline()).map((f) => f.entries.map((e) => e.id))).toEqual([['s2', 'b3', 's4', 'b5']])
  })

  test("can't be created twice, and needs valid paths", async () => {
    const { write } = await created()
    expect(await write({ type: 'create', title: 'Again', files: [{ path: 'x.md', content: '' }] })).toMatchObject({ ok: false, error: { code: 'exists' } })
    const fresh = await setup()
    expect(await fresh.write({ type: 'create', title: 'Bad', files: [{ path: '../x.md', content: '' }] })).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(await fresh.write({ type: 'create', title: '', files: [{ path: 'a.md', content: '' }] })).toMatchObject({ ok: false, error: { code: 'invalid' } })
  })
})

describe('editing with a batch', () => {
  test('makes a new version with its steps, and moves comments by rule', async () => {
    const { service, write } = await created()
    const comment = value(await write({ type: 'comment', version: 1, anchor: { kind: 'text', file: 'f1', start: 15, end: 20 }, body: 'Which brown?' }, REVIEWER))
    expect(comment).toEqual({ kind: 'comment', comment: 'c1' })
    const section = value(await write({ type: 'comment', version: 1, anchor: { kind: 'section', section: 's4' }, body: 'Add more risks' }, REVIEWER))

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
      { step: 0, command: { command: 'replace', in: 'b3', old: 'brown', new: 'red', addresses: ['c1'] }, addresses: ['c1'] },
      { step: 1, command: { command: 'move', target: 's4', to: { start: 'f1' } }, addresses: [] },
    ])

    const v2 = await service.comments(2)
    expect(v2.map((c) => [c.id, c.state, c.anchor?.kind === 'text' ? c.anchor.quote : c.anchor?.kind, c.addressedIn])).toEqual([
      ['c1', 'changed', 'red', [2]],
      [(section as { comment: string }).comment, 'moved', 'section', []],
    ])
    // older versions still show comments where they were then
    const v1 = await service.comments(1)
    expect(v1.map((c) => [c.id, c.state, c.anchor?.kind === 'text' ? c.anchor.quote : c.anchor?.kind])).toEqual([
      ['c1', 'exact', 'brown'],
      ['c2', 'exact', 'section'],
    ])
  })

  test('a comment that becomes outdated links to the last version where it applied', async () => {
    const { service, write } = await created()
    // plain text: "Plan\nThe quick brown fox.\nRisks\nIt might rain."; "rain" is 41–45
    await write({ type: 'comment', version: 1, anchor: { kind: 'text', file: 'f1', start: 41, end: 45 }, body: 'Rain?' })
    await write({ type: 'edit', batch: { base: 1, steps: [{ command: 'delete', target: 'b5' }] } })
    await write({ type: 'edit', batch: { base: 2, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'More.' }] } })
    const [c] = await service.comments(3)
    expect(c).toMatchObject({ id: 'c1', state: 'outdated', anchor: null, lastVersion: 1 })
  })

  test('a stale batch replays onto the latest version, or conflicts', async () => {
    const { write } = await created()
    await write({ type: 'edit', batch: { base: 1, steps: [{ command: 'replace', in: 'b5', old: 'rain', new: 'snow' }] } })
    expect(await write({ type: 'edit', batch: { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'quick', new: 'slow' }] } })).toMatchObject({
      ok: true,
      value: { version: 3 },
    })
    expect(await write({ type: 'edit', batch: { base: 1, steps: [{ command: 'replace', in: 'b5', old: 'rain', new: 'hail' }] } })).toMatchObject({
      ok: false,
      error: { code: 'conflict', details: { conflicts: [{ step: 0, reason: 'no_match' }] } },
    })
  })

  test('only the owner edits, for now', async () => {
    const { write } = await created()
    expect(await write({ type: 'edit', batch: { base: 1, steps: [{ command: 'delete', target: 'b3' }] } }, REVIEWER)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
  })

  test('a preview shows the result without changing anything', async () => {
    const { service } = await created()
    const preview = await service.preview({ base: 1, steps: [{ command: 'replace', in: 'b3', old: 'brown', new: 'red' }] })
    expect(preview).toMatchObject({ ok: true, base: 1, files: [{ file: 'f1', path: 'plan.md', before: PLAN, content: PLAN.replace('brown', 'red') }] })
    expect((await service.summary())!.latest).toBe(1)
  })
})

describe('uploading an edited copy', () => {
  test('needs the latest version as its base, unless forced', async () => {
    const { service, write } = await created()
    const base = await contentHash(PLAN)
    const v2 = PLAN.replace('rain', 'snow')
    expect(value(await write({ type: 'upload', files: [{ file: 'f1', path: 'plan.md', content: v2, base }] }))).toMatchObject({ version: 2 })
    expect((await service.summary())!.versions.at(-1)!.how).toBe('upload')
    // uploading again from the old base: pull first
    const stale = await write({ type: 'upload', files: [{ file: 'f1', path: 'plan.md', content: PLAN.replace('rain', 'hail'), base }] })
    expect(stale).toMatchObject({ ok: false, error: { code: 'pull_first', details: { files: [{ file: 'f1', base, latest: await contentHash(v2) }] } } })
    // or force it
    expect(await write({ type: 'upload', force: true, files: [{ file: 'f1', path: 'plan.md', content: PLAN.replace('rain', 'hail'), base }] })).toMatchObject({
      ok: true,
      value: { version: 3 },
    })
  })

  test('re-anchors comments through the diff', async () => {
    const { service, write } = await created()
    await write({ type: 'comment', version: 1, anchor: { kind: 'text', file: 'f1', start: 15, end: 20 }, body: 'Which brown?' })
    const content = PLAN.replace('The quick brown fox.', 'The quick **brown** fox\njumps.')
    await write({ type: 'upload', files: [{ file: 'f1', path: 'plan.md', content, base: await contentHash(PLAN) }] })
    // bold and re-wrapping don't change the plain text the comment is on
    const [c] = await service.comments(2)
    expect(c).toMatchObject({ state: 'exact', anchor: { quote: 'brown' } })
  })
})

describe('size limits', () => {
  const small: Limits = { maxFileBytes: 100, maxIdeaBytes: 150 }

  test('refuse a file or an idea over the limit, before parsing', async () => {
    const s = await setup(small)
    expect(await s.write({ type: 'create', title: 'Big', files: [{ path: 'a.md', content: 'x'.repeat(101) }] })).toMatchObject({
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
    ).toMatchObject({ ok: false, error: { code: 'too_large', details: { problems: [{ path: null, bytes: 160, limit: 150 }] } } })
  })

  test('apply to the result of a batch', async () => {
    const s = await setup(small)
    await s.write({ type: 'create', title: 'Small', files: [{ path: 'a.md', content: 'Short.\n' }] })
    expect(await s.write({ type: 'edit', batch: { base: 1, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'y'.repeat(120) }] } })).toMatchObject({
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
    await big.write({ key: 'a', caller: OWNER, write: { type: 'create', title: 'T', files: [{ path: 'a.md', content }] } })
    const lowered = new IdeaService('i', { sql, files, core: inProcessCore(), limits: small })
    const shrunk = await lowered.write({ key: 'b', caller: OWNER, write: { type: 'edit', batch: { base: 1, steps: [{ command: 'replace', in: 'b2', old: 'Start. filler', new: 'Start.' }] } } })
    expect(shrunk.result).toMatchObject({ ok: true })
    const grown = await lowered.write({ key: 'c', caller: OWNER, write: { type: 'edit', batch: { base: 2, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'More.' }] } } })
    expect(grown.result).toMatchObject({ ok: false, error: { code: 'too_large' } })
  })
})

describe('comments', () => {
  test('replies, resolving, and anchors checked against the latest version', async () => {
    const { service, write } = await created()
    expect(await write({ type: 'comment', version: 1, anchor: { kind: 'text', file: 'f1', start: 0, end: 999 }, body: 'x' })).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(await write({ type: 'comment', version: 1, anchor: { kind: 'section', section: 'b3' }, body: 'x' })).toMatchObject({ ok: false, error: { code: 'invalid' } })
    value(await write({ type: 'comment', version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'Overall: good' }))
    value(await write({ type: 'reply', parent: 'c1', body: 'Thanks' }, REVIEWER))
    value(await write({ type: 'resolve', comment: 'c1', resolved: true }))
    await write({ type: 'edit', batch: { base: 1, steps: [{ command: 'delete', target: 'b3' }] } })
    expect(await write({ type: 'comment', version: 1, anchor: { kind: 'file', file: 'f1' }, body: 'late' })).toMatchObject({ ok: false, error: { code: 'stale_version' } })
    const [c] = await service.comments()
    expect(c).toMatchObject({ id: 'c1', resolved: true, state: 'exact', body: 'Overall: good', replies: [{ id: 'c2', body: 'Thanks', author: REVIEWER }] })
  })
})

describe('retries', () => {
  test('a write retried with the same key is applied once and returns the same result', async () => {
    const { service } = await created()
    const once = await service.write({ key: 'same', caller: OWNER, write: { type: 'edit', batch: { base: 1, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'New.' }] } } })
    const again = await service.write({ key: 'same', caller: OWNER, write: { type: 'edit', batch: { base: 1, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: 'New.' }] } } })
    expect(again.result).toEqual(once.result)
    expect(again.events).toEqual([])
    expect((await service.summary())!.latest).toBe(2)
  })

  test('the latest version survives a restart (a new service on the same storage)', async () => {
    const { sql, files, write } = await created()
    await write({ type: 'edit', batch: { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'quick', new: 'slow' }] } })
    const restarted = new IdeaService('idea-1', { sql, files, core: inProcessCore(), limits: DEFAULT_LIMITS })
    expect((await restarted.file(undefined, 'f1'))!.content).toContain('The slow brown fox.')
    const next = await restarted.write({ key: 'after-restart', caller: OWNER, write: { type: 'edit', batch: { base: 2, steps: [{ command: 'replace', in: 'b3', old: 'slow', new: 'fast' }] } } })
    expect(next.result).toMatchObject({ ok: true, value: { version: 3 } })
  })
})
