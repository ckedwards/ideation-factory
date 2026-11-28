// Files made, renamed and deleted in the draft (docs: Files in the browser, step 2): kept beside its
// documents, carried by restore points, committed with the text, and checked against versions made
// elsewhere. IdeaService without Rivet, as service.test.ts runs it.
import { describe, expect, test } from 'bun:test'
import { inProcessCore } from '../core-pool/runner.ts'
import { MemoryFileStore } from '../files/memory.ts'
import { DEFAULT_LIMITS } from '../limits.ts'
import { bunSql } from '../sql/sql-bun.ts'
import { migrate } from './schema.ts'
import { type Caller, IdeaService, type WriteResult } from './service.ts'

const OWNER: Caller = { user: 'riley', bot: null, purpose: 'me' }
const PLAN = '# Plan\n\nSee [notes](notes.md).\n\n## Risks\n\nIt might rain.\n'
const NOTES = 'Notes.\n'
// f1 plan.md: s2, b3, s4, b5; f6 notes.md: b7; next ID 8

async function created() {
  const sql = bunSql()
  await migrate(sql)
  let clock = 1_000
  const service = new IdeaService('idea-1', {
    sql,
    files: new MemoryFileStore(),
    core: inProcessCore(),
    limits: DEFAULT_LIMITS,
    now: () => clock++,
  })
  let n = 0
  const write = async (write: unknown, caller: Caller = OWNER) =>
    (await service.write({ key: `k${++n}`, caller, write })).result
  value(
    await write({
      type: 'create',
      title: 'Plan',
      files: [
        { path: 'plan.md', content: PLAN },
        { path: 'notes.md', content: NOTES },
      ],
    }),
  )
  return { service, write }
}

const value = (r: WriteResult) => {
  if (!r.ok) {
    throw new Error(`expected ok: ${JSON.stringify(r.error)}`)
  }
  return r.value
}

describe('a file made in the draft', () => {
  test('takes an ID from the server, which committing keeps', async () => {
    const { service, write } = await created()
    expect(
      value(await write({ type: 'draft', changes: [{ kind: 'create-file', path: 'costs.md', markdown: '' }] })),
    ).toEqual({ kind: 'draft', keys: ['c-f8'] })
    // typed into, by its ID
    value(await write({ type: 'draft', changes: [{ kind: 'insert', at: { start: 'f8' }, markdown: 'A pound.' }] }))
    const draft = await service.draft()
    expect(draft.files.find((f) => f.file === 'f8')).toMatchObject({
      path: 'costs.md',
      content: 'A pound.\n',
      made: 'c-f8',
      was: null,
    })
    expect(draft.changes.map((c) => c.change.kind)).toEqual(['create-file', 'insert'])
    // it opens to type in, empty to start with as its document is
    expect(await service.openDraftFile('f8')).toMatchObject({ version: expect.any(Number) })

    expect(value(await write({ type: 'commit' }))).toMatchObject({ version: 2 })
    expect((await service.file(2, 'f8'))!).toMatchObject({ path: 'costs.md', content: 'A pound.\n' })
    expect((await service.draft()).changes).toEqual([])
  })

  test('from an agent with its text: the text is in its document, as typing would put it', async () => {
    const { service, write } = await created()
    value(await write({ type: 'draft', changes: [{ kind: 'create-file', path: 'costs.md', markdown: 'A pound.' }] }))
    const draft = await service.draft()
    expect(draft.files.find((f) => f.file === 'f8')!.content).toBe('A pound.\n')
    expect(draft.changes.map((c) => c.change)).toEqual([
      { kind: 'create-file', path: 'costs.md', markdown: '', file: 'f8' },
      { kind: 'insert', at: { start: 'f8' }, markdown: 'A pound.' },
    ])
  })

  test('isn’t given an ID by the caller', async () => {
    const { write } = await created()
    expect(
      await write({ type: 'draft', changes: [{ kind: 'create-file', path: 'a.md', markdown: '', file: 'f99' }] }),
    ).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(
      await write({
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'create-file', path: 'a.md', markdown: '', file: 'f99' }] },
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid' } })
  })

  test('keeps its ID through a version made elsewhere, whose IDs start after it', async () => {
    const { service, write } = await created()
    value(await write({ type: 'draft', changes: [{ kind: 'create-file', path: 'costs.md', markdown: '' }] }))
    value(
      await write({
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'insert', at: { after: 'b7' }, markdown: 'More notes.' }] },
      }),
    )
    const notes = (await service.outline()).find((f) => f.id === 'f6')!
    expect(notes.entries.map((e) => e.id)).toEqual(['b7', 'b9'])
    expect((await service.draft()).files.find((f) => f.path === 'costs.md')!.file).toBe('f8')
  })

  test('renamed, is made at its new path', async () => {
    const { service, write } = await created()
    value(await write({ type: 'draft', changes: [{ kind: 'create-file', path: 'costs.md', markdown: '' }] }))
    value(
      await write({
        type: 'draft',
        changes: [{ kind: 'rename-file', file: 'f8', path: 'research/costs.md', was: 'costs.md' }],
      }),
    )
    const draft = await service.draft()
    expect(draft.changes.map((c) => c.change)).toEqual([
      { kind: 'create-file', path: 'research/costs.md', markdown: '', file: 'f8' },
    ])
  })
})

describe('a file renamed in the draft', () => {
  test('with its links fixed in the same go, and renamed again, is one rename from the latest path', async () => {
    const { service, write } = await created()
    value(
      await write({
        type: 'draft',
        changes: [
          { kind: 'rename-file', file: 'f6', path: 'findings.md', was: 'notes.md' },
          { kind: 'edit', id: 'b3', source: 'See [notes](findings.md).', was: 'See [notes](notes.md).' },
        ],
      }),
    )
    value(
      await write({
        type: 'draft',
        changes: [{ kind: 'rename-file', file: 'f6', path: 'found.md', was: 'findings.md' }],
      }),
    )
    const draft = await service.draft()
    expect(draft.files.find((f) => f.file === 'f6')).toMatchObject({ path: 'found.md', was: 'notes.md' })
    expect(draft.changes.filter((c) => c.change.kind === 'rename-file').map((c) => c.change)).toEqual([
      { kind: 'rename-file', file: 'f6', path: 'found.md', was: 'notes.md' },
    ])
    // and back to its path in the latest version: no rename left
    value(
      await write({ type: 'draft', changes: [{ kind: 'rename-file', file: 'f6', path: 'notes.md', was: 'found.md' }] }),
    )
    expect((await service.draft()).changes.map((c) => c.change.kind)).toEqual(['edit'])
  })

  test('made against a path it no longer has is refused as outdated', async () => {
    const { write } = await created()
    value(
      await write({ type: 'draft', changes: [{ kind: 'rename-file', file: 'f6', path: 'found.md', was: 'notes.md' }] }),
    )
    expect(
      await write({ type: 'draft', changes: [{ kind: 'rename-file', file: 'f6', path: 'x.md', was: 'notes.md' }] }),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } })
  })
})

describe('a file deleted in the draft', () => {
  test('keeps what was typed in it, can’t be typed in, and comes back when the delete is undone', async () => {
    const { service, write } = await created()
    await service.openDraftFile('f6')
    value(await write({ type: 'draft', changes: [{ kind: 'edit', id: 'b7', source: 'Notes, more.', was: 'Notes.' }] }))
    const deleted = value(await write({ type: 'draft', changes: [{ kind: 'delete-file', file: 'f6' }] }))
    expect(deleted).toEqual({ kind: 'draft', keys: ['x-f6'] })
    const draft = await service.draft()
    expect(draft.files.map((f) => f.file)).toEqual(['f1'])
    expect(draft.deleted).toEqual([
      { file: 'f6', path: 'notes.md', content: 'Notes, more.\n', change: 'x-f6', made: null },
    ])
    const typed = await service.typing({ file: 'f6', version: 1, steps: [], client: 'c1', caller: OWNER })
    expect(typed.result).toMatchObject({ kind: 'refused', message: expect.stringContaining('deleted') })

    value(await write({ type: 'undraft', key: 'x-f6' }))
    const restored = await service.draft()
    expect(restored.deleted).toEqual([])
    expect(restored.files.find((f) => f.file === 'f6')!.content).toBe('Notes, more.\n')
  })

  test('committed, is gone from the version', async () => {
    const { service, write } = await created()
    value(await write({ type: 'draft', changes: [{ kind: 'delete-file', file: 'f6' }] }))
    value(await write({ type: 'commit' }))
    expect((await service.files(2)).map((f) => f.path)).toEqual(['plan.md'])
  })
})

describe('the draft’s file changes and versions made elsewhere', () => {
  test('a version that takes the path of a file the draft makes is refused as draft_outdated', async () => {
    const { write } = await created()
    value(await write({ type: 'draft', changes: [{ kind: 'create-file', path: 'costs.md', markdown: '' }] }))
    expect(
      await write({
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'create-file', path: 'costs.md', markdown: 'Theirs.' }] },
      }),
    ).toMatchObject({ ok: false, error: { code: 'draft_outdated' } })
  })

  test('a version that changes a file the draft deletes is refused, as deleting it would lose its words', async () => {
    const { write } = await created()
    value(await write({ type: 'draft', changes: [{ kind: 'delete-file', file: 'f6' }] }))
    expect(
      await write({
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'replace', in: 'b7', old: 'Notes', new: 'Our notes' }] },
      }),
    ).toMatchObject({ ok: false, error: { code: 'draft_outdated' } })
  })

  test('a version that renames a file the draft renames is refused as draft_outdated', async () => {
    const { write } = await created()
    value(
      await write({ type: 'draft', changes: [{ kind: 'rename-file', file: 'f6', path: 'found.md', was: 'notes.md' }] }),
    )
    expect(
      await write({
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'rename-file', file: 'f6', path: 'kept.md' }] },
      }),
    ).toMatchObject({ ok: false, error: { code: 'draft_outdated' } })
  })

  test('a version that changes a file the draft renames goes in, and the rename stays', async () => {
    const { service, write } = await created()
    value(
      await write({ type: 'draft', changes: [{ kind: 'rename-file', file: 'f6', path: 'found.md', was: 'notes.md' }] }),
    )
    value(
      await write({
        type: 'edit',
        batch: { base: 1, steps: [{ command: 'replace', in: 'b7', old: 'Notes', new: 'Our notes' }] },
      }),
    )
    expect((await service.draft()).files.find((f) => f.file === 'f6')).toMatchObject({
      path: 'found.md',
      content: 'Our notes.\n',
    })
  })
})

describe('restore points', () => {
  test('carry the draft’s file changes: a discard of a new file is taken back', async () => {
    const { service, write } = await created()
    value(await write({ type: 'draft', changes: [{ kind: 'create-file', path: 'costs.md', markdown: 'A pound.' }] }))
    value(await write({ type: 'draft', changes: [{ kind: 'delete-file', file: 'f6' }] }))
    const discarded = value(await write({ type: 'discard' })) as { point: number }
    expect((await service.draft()).files.map((f) => f.path)).toEqual(['plan.md', 'notes.md'])
    value(await write({ type: 'restore', point: discarded.point }))
    const draft = await service.draft()
    expect(draft.files.map((f) => [f.file, f.path, f.content])).toEqual([
      ['f1', 'plan.md', PLAN],
      ['f8', 'costs.md', 'A pound.\n'],
    ])
    expect(draft.deleted.map((d) => d.file)).toEqual(['f6'])
  })
})

describe('an address made before a rename', () => {
  test('still finds the file, where it is now; one deleted since finds nothing', async () => {
    const { service, write } = await created()
    value(
      await write({ type: 'draft', changes: [{ kind: 'rename-file', file: 'f6', path: 'found.md', was: 'notes.md' }] }),
    )
    value(await write({ type: 'commit' }))
    expect(await service.findFile('found.md')).toEqual({ file: 'f6', path: 'found.md', was: null })
    expect(await service.findFile('notes.md')).toEqual({ file: 'f6', path: 'found.md', was: 'notes.md' })
    value(await write({ type: 'draft', changes: [{ kind: 'delete-file', file: 'f6' }] }))
    value(await write({ type: 'commit' }))
    expect(await service.findFile('notes.md')).toBeNull()
  })
})
