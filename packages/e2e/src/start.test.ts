// ideaf start --branch and --worktree, in real git repositories.
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { repo, server } from './harness.ts'

beforeAll(() => server(), 60_000)

/** A repository with a commit on main, and an uncommitted plan. */
async function committed() {
  const r = await repo({ 'README.md': '# Readme\n' })
  r.git('add', '.')
  r.git('commit', '-qm', 'first')
  await r.write('docs/plan.md', '# Plan\n')
  return r
}

describe('ideaf start --branch', () => {
  test('makes a branch off the default branch, and the plan comes along', async () => {
    const r = await committed()
    const started = await r.ideaf('start', 'docs', '--title', 'Branched', '--branch', 'idea/branched', '--json')
    expect(started.exit).toBe(0)
    expect(started.json()).toMatchObject({ branch: 'idea/branched' })
    expect(r.git('branch', '--show-current')).toBe('idea/branched')
    expect(await r.read('docs/plan.md')).toBe('# Plan\n')
    expect((await r.ideaf('list', '--json')).json().items[0]).toMatchObject({ active: true, branch: 'idea/branched' })
  })

  test('from another branch, where the plan is committed: it is still there, and nothing looks deleted', async () => {
    const r = await committed()
    r.git('switch', '-qc', 'feature')
    r.git('add', '.')
    r.git('commit', '-qm', 'plan')
    expect((await r.ideaf('start', 'docs', '--title', 'Off main', '--branch', 'idea/off-main')).exit).toBe(0)
    // made off main, not off the feature branch it was started from
    expect(() => r.git('merge-base', '--is-ancestor', 'feature', 'HEAD')).toThrow()
    expect(r.git('branch', '--show-current')).toBe('idea/off-main')
    expect(await r.read('docs/plan.md')).toBe('# Plan\n')
    expect((await r.ideaf('sync', 'docs')).out).toBe('Nothing to sync.')
  })

  test('with --worktree: the branch is checked out in a new worktree, with copies of the files', async () => {
    const r = await committed()
    const wt = `${r.dir}-idea`
    const started = await r.ideaf(
      'start',
      'docs',
      '--title',
      'Elsewhere',
      '--branch',
      'idea/elsewhere',
      '--worktree',
      wt,
      '--json',
    )
    expect(started.exit).toBe(0)
    const { idea } = started.json()
    expect(started.json()).toMatchObject({ branch: 'idea/elsewhere', worktree: wt })
    expect(r.git('branch', '--show-current')).toBe('main')
    expect(await readFile(join(wt, 'docs/plan.md'), 'utf8')).toBe('# Plan\n')
    expect(await r.read('docs/plan.md')).toBe('# Plan\n') // the original is left alone
    const gitDir = r.git('-C', wt, 'rev-parse', '--absolute-git-dir')
    expect((await readFile(join(gitDir, 'ideaf-active'), 'utf8')).trim()).toBe(idea)
    // from the first worktree, changing to it points there
    expect((await r.ideaf('change', idea, '--json')).json().error).toMatchObject({ details: { worktree: wt } })
  })

  test('refuses what it can’t do', async () => {
    const r = await committed()
    expect((await r.ideaf('start', 'docs', '--title', 'X', '--worktree', '../x')).exit).toBe(2)
    expect((await r.ideaf('start', 'docs', '--title', 'X', '--branch', 'main')).err).toContain('already a branch')
    const empty = await repo({ 'plan.md': '# P\n' })
    expect((await empty.ideaf('start', '--title', 'X', '--branch', 'x')).err).toContain('commit something first')
    const plain = await repo({ 'plan.md': '# P\n' }, { git: false })
    expect((await plain.ideaf('start', '--title', 'X', '--branch', 'x')).err).toContain('need a git repository')
  })
})
