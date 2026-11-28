// An idea's files as a tree (file-tree.ts).
import { describe, expect, test } from 'bun:test'
import { buildTree, folderPaths, type TreeFile, visibleRows } from './file-tree.ts'

const files: TreeFile[] = [
  { id: 'f1', path: 'offline.md', comments: 1 },
  { id: 'f2', path: 'research/interviews.md', state: 'new' },
  { id: 'f3', path: 'research/competitors/notion.md', comments: 2 },
  { id: 'f4', path: 'decisions/sync.md', state: 'deleted' },
  { id: 'f5', path: 'decisions/queue.md', state: 'deleted', comments: 1 },
  { id: 'f6', path: 'packages/server/docs/storage.md' },
  { id: 'f7', path: 'images/chart.png' },
]
const names = (rows: ReturnType<typeof visibleRows>) =>
  rows.map((r) => `${'  '.repeat(r.depth)}${r.kind === 'folder' ? `${r.node.name}/` : r.node.name}`)

describe('the tree', () => {
  test('folders above files, each by name; a chain of folders holding only a folder on one row', () => {
    expect(names(visibleRows(buildTree(files), new Set(), null))).toEqual([
      'decisions/',
      '  queue.md',
      '  sync.md',
      'images/',
      '  chart.png',
      'packages/server/docs/',
      '  storage.md',
      'research/',
      '  competitors/',
      '    notion.md',
      '  interviews.md',
      'offline.md',
    ])
  })

  test('a folder says what’s inside: its files, open comments, and whether the draft changes them', () => {
    const tree = buildTree(files)
    const research = tree.folders.find((f) => f.path === 'research')!
    expect(research).toMatchObject({ count: 2, comments: 2, changed: true, deleted: false })
    const decisions = tree.folders.find((f) => f.path === 'decisions')!
    expect(decisions).toMatchObject({ count: 2, comments: 1, changed: true, deleted: true })
    expect(tree.folders.find((f) => f.name === 'packages/server/docs')).toMatchObject({
      path: 'packages/server/docs',
      changed: false,
    })
  })

  test('a closed folder hides what’s in it, unless it holds the file being read', () => {
    const tree = buildTree(files)
    const closed = new Set(['research', 'decisions'])
    expect(names(visibleRows(tree, closed, null))).toEqual([
      'decisions/',
      'images/',
      '  chart.png',
      'packages/server/docs/',
      '  storage.md',
      'research/',
      'offline.md',
    ])
    const reading = visibleRows(tree, closed, 'research/competitors/notion.md')
    expect(names(reading)).toContain('    notion.md')
    expect(reading.find((r) => r.kind === 'folder' && r.node.path === 'research')).toMatchObject({ open: true })
  })

  test('a chain splits once a file is in a folder in the middle of it', () => {
    const more = [...files, { id: 'f8', path: 'packages/server/README.md' }]
    expect(
      names(visibleRows(buildTree(more), new Set(), null)).filter((n) => n.includes('packages') || n.startsWith('  ')),
    ).toContain('packages/server/')
  })

  test('with no folders, it’s the plain list it always was', () => {
    const flat = [
      { id: 'f1', path: 'plan.md' },
      { id: 'f2', path: 'notes.md' },
    ]
    expect(names(visibleRows(buildTree(flat), new Set(), null))).toEqual(['notes.md', 'plan.md'])
  })

  test('every folder’s path, the middle of a chain too', () => {
    expect([...folderPaths(files)].sort()).toEqual([
      'decisions',
      'images',
      'packages',
      'packages/server',
      'packages/server/docs',
      'research',
      'research/competitors',
    ])
  })
})
