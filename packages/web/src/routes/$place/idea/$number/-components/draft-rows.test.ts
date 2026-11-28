// The draft's changes as rows of the list of changes (draft-rows.ts).
import { describe, expect, test } from 'bun:test'
import type { DraftChange } from '@ideaf/core'
import { type DraftChangeEntry, filesChanged, rowsOf } from './draft-rows.ts'

const riley = { user: 'riley', bot: null }
let n = 0
const entry = (change: DraftChange, at = 1, by = riley): DraftChangeEntry => ({ key: `k${++n}`, change, by, at })
const rename = (file: string, was: string, path: string, at = 1) => entry({ kind: 'rename-file', file, was, path }, at)
const labels = (rows: ReturnType<typeof rowsOf>) =>
  rows.map((r) => r.folder?.label ?? r.entries.map((e) => e.key).join(','))

describe('the rows', () => {
  test('a folder renamed is one row, with every rename under it', () => {
    const entries = [
      entry({ kind: 'edit', id: 'b3', source: 'x', was: 'y' }),
      rename('f2', 'research/interviews.md', 'findings/interviews.md'),
      rename('f3', 'research/competitors/notion.md', 'findings/competitors/notion.md'),
    ]
    const rows = rowsOf(entries, () => null, [])
    expect(labels(rows)).toEqual([entries[0]!.key, 'Renamed research to findings (2 files)'])
    expect(rows[1]!.keys).toEqual([entries[1]!.key, entries[2]!.key])
  })

  test('renames made apart, or not of one folder, are a row each', () => {
    const apart = [rename('f2', 'a/x.md', 'b/x.md', 1), rename('f3', 'a/y.md', 'b/y.md', 2)]
    expect(rowsOf(apart, () => null, []).map((r) => r.folder)).toEqual([null, null])
    const mixed = [rename('f2', 'a/x.md', 'b/x.md'), rename('f3', 'c/y.md', 'd/z.md')]
    expect(rowsOf(mixed, () => null, []).map((r) => r.folder)).toEqual([null, null])
  })

  test('a folder deleted whole is one row; some of its files deleted, a row each', () => {
    const paths: Record<string, string> = { f2: 'research/a.md', f3: 'research/deep/b.md' }
    const deletes = [entry({ kind: 'delete-file', file: 'f2' }), entry({ kind: 'delete-file', file: 'f3' })]
    expect(labels(rowsOf(deletes, (f) => paths[f] ?? null, ['plan.md']))).toEqual(['Deleted research (2 files)'])
    expect(rowsOf(deletes, (f) => paths[f] ?? null, ['research/c.md']).map((r) => r.folder)).toEqual([null, null])
  })
})

test('the files changed: their text, their path, made or deleted', () => {
  const latest = new Map([
    ['f1', 'A.\n'],
    ['f2', 'B.\n'],
    ['f3', 'C.\n'],
  ])
  const files = [
    { file: 'f1', content: 'A.\n', made: null, was: null },
    { file: 'f2', content: 'B, edited.\n', made: null, was: null },
    { file: 'f3', content: 'C.\n', made: null, was: 'old.md' },
    { file: 'f9', content: '', made: 'c-f9', was: null },
  ]
  expect(filesChanged(files, 1, latest)).toBe(4)
})
