// The files a commit takes, as its dialog lists them (commit-files.ts).
import { describe, expect, test } from 'bun:test'
import { type CommitFileInput, type CommitRow, commitRows } from './commit-files.ts'

const file = (id: string, path: string, more: Partial<CommitFileInput> = {}): CommitFileInput => ({
  file: id,
  path,
  content: `text of ${id}`,
  made: null,
  was: null,
  ...more,
})
// the latest version's text: each file's own, so a file is changed only when the test says
const latestOf = (files: CommitFileInput[], ...changed: string[]) =>
  new Map(files.filter((f) => !f.made).map((f) => [f.file, changed.includes(f.file) ? 'older' : f.content]))
// a row as one line: indent, a folder's slash, the old name struck (~~), the note
const lines = (rows: CommitRow[]) =>
  rows.map(
    (r) =>
      `${'  '.repeat(r.depth)}${r.was ? `~~${r.was}~~ ` : ''}${r.name}${r.kind === 'folder' ? '/' : ''}${r.note ? ` · ${r.note}` : ''}`,
  )

describe('the files a commit takes', () => {
  test('as a tree of the files it touches: new, edited, moved, a folder renamed, a folder emptied', () => {
    const files = [
      file('f1', 'offline.md'),
      file('f2', 'findings/interviews.md', { was: 'research/interviews.md' }),
      file('f3', 'findings/competitors.md', { was: 'research/competitors.md' }),
      file('f4', 'findings/costs.md', { made: 'm1' }),
      file('f5', 'decisions/sync-states.md', { was: 'notes/sync-states.md' }),
      file('f6', 'readme.md'),
    ]
    const rows = commitRows(files, [{ file: 'f7', path: 'notes/standup.md' }], latestOf(files, 'f1', 'f2'))
    expect(lines(rows)).toEqual([
      'decisions/',
      '  ~~notes/sync-states.md~~ sync-states.md · Moved',
      '~~research~~ findings/ · Renamed · 2 files',
      '  costs.md · New',
      '  interviews.md · Edited',
      'notes/ · Deleted',
      '  standup.md · Deleted',
      'offline.md · Edited',
    ])
    // each file opens its comparison; a folder doesn't
    expect(rows.find((r) => r.name === 'interviews.md')).toMatchObject({ file: 'f2', state: 'changed' })
    expect(rows.find((r) => r.name === 'standup.md')).toMatchObject({ file: 'f7', state: 'deleted' })
    expect(rows[0]).toMatchObject({ kind: 'folder', file: null })
  })

  test('a file renamed in its folder, renamed and edited, and moved alone out of a folder', () => {
    const files = [
      file('a', 'plan.md', { was: 'roadmap.md' }),
      file('b', 'notes/2026.md', { was: 'notes/2025.md' }),
      file('c', 'archive/old.md', { was: 'drafts/old.md' }),
    ]
    expect(lines(commitRows(files, [], latestOf(files, 'b')))).toEqual([
      'archive/',
      '  ~~drafts/old.md~~ old.md · Moved',
      'notes/',
      '  ~~2025.md~~ 2026.md · Renamed · edited',
      '~~roadmap.md~~ plan.md · Renamed',
    ])
  })

  test('a folder renamed with folders in it is one row, at its top; one inside renamed with it isn’t', () => {
    const files = [
      file('a', 'findings/interviews/ana.md', { was: 'research/interviews/ana.md' }),
      file('b', 'findings/interviews/ben.md', { was: 'research/interviews/ben.md' }),
      file('c', 'findings/costs.md', { was: 'research/costs.md' }),
    ]
    expect(lines(commitRows(files, [], latestOf(files, 'b')))).toEqual([
      '~~research~~ findings/ · Renamed · 3 files',
      '  interviews/',
      '    ben.md · Edited',
    ])
  })

  test('files moved out of a folder that keeps others aren’t a folder renamed', () => {
    const files = [
      file('a', 'done/one.md', { was: 'todo/one.md' }),
      file('b', 'done/two.md', { was: 'todo/two.md' }),
      file('c', 'todo/three.md'),
    ]
    expect(lines(commitRows(files, [], latestOf(files)))).toEqual([
      'done/',
      '  ~~todo/one.md~~ one.md · Moved',
      '  ~~todo/two.md~~ two.md · Moved',
    ])
  })

  test('a folder moved into another is struck as its whole path', () => {
    const files = [
      file('a', 'archive/research/one.md', { was: 'research/one.md' }),
      file('b', 'archive/research/two.md', { was: 'research/two.md' }),
    ]
    expect(lines(commitRows(files, [], latestOf(files)))).toEqual([
      'archive/',
      '  ~~research~~ research/ · Moved · 2 files',
    ])
  })

  test('nothing touched, nothing listed', () => {
    const files = [file('a', 'plan.md')]
    expect(commitRows(files, [], latestOf(files))).toEqual([])
  })
})
