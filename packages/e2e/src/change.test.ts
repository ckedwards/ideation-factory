// ideaf change, end to end: switching ideas and their branches, worktrees,
// ideas not in the repository yet, --title, and the picker.
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { api, repo, server, token } from './harness.ts'

beforeAll(() => server(), 60_000)

const run = crypto.randomUUID().slice(0, 6)
const h = (name: string) => `${name}-${run}`

/** A repository with idea A started on main and idea B on feat-b (checked out, and active). */
async function twoBranches(answers?: string[]) {
  const r = await repo({ 'a/plan.md': '# A\n' }, { token: token(h('riley')), ...(answers ? { answers } : {}) })
  r.git('add', '.')
  r.git('commit', '-qm', 'a')
  const a: string = (await r.ideaf('start', 'a', '--title', 'Plan alpha', '--json')).json().idea
  r.git('switch', '-qc', 'feat-b')
  await r.write('b/plan.md', '# B\n')
  r.git('add', '.')
  r.git('commit', '-qm', 'b')
  const b: string = (await r.ideaf('start', 'b', '--title', 'Plan beta', '--json')).json().idea
  return { r, a, b }
}

const activeOf = async (r: { ideaf: (...argv: string[]) => Promise<{ json: () => any }> }) =>
  (await r.ideaf('list', '--anyone', '--json')).json().items.find((i: { active: boolean }) => i.active)?.id

describe('ideaf change', () => {
  test("switches to the idea's branch, and back", async () => {
    const { r, a, b } = await twoBranches()
    const changed = await r.ideaf('change', a)
    expect(changed.exit).toBe(0)
    expect(changed.out).toBe(`Now on "Plan alpha" (${a}), on branch main.`)
    expect(r.git('branch', '--show-current')).toBe('main')
    expect(await activeOf(r)).toBe(a)

    expect((await r.ideaf('change', b, '--json')).json()).toMatchObject({ idea: b, branch: 'feat-b', switched: true })
    expect(r.git('branch', '--show-current')).toBe('feat-b')
    expect((await r.ideaf('change', b)).out).toBe(`Already on "Plan beta" (${b}).`)
  })

  test("won't carry uncommitted changes to another branch, unless told to stay with --here", async () => {
    const { r, a } = await twoBranches()
    await r.write('b/plan.md', '# B, edited\n')
    const refused = await r.ideaf('change', a)
    expect(refused.exit).toBe(1)
    expect(refused.err).toContain('commit or stash them first')
    expect(refused.err).toContain('b/plan.md')
    expect(r.git('branch', '--show-current')).toBe('feat-b')

    const here = await r.ideaf('change', a, '--here', '--json')
    expect(here.exit).toBe(0)
    expect(here.json()).toMatchObject({ idea: a, branch: 'feat-b', switched: false })
    expect(await activeOf(r)).toBe(a)
  })

  test('points to the worktree its branch is checked out in, and makes it the idea there', async () => {
    const { r, b } = await twoBranches()
    r.git('switch', '-q', 'main')
    const wt = `${r.dir}-wt`
    r.git('worktree', 'add', '-q', wt, 'feat-b')

    const elsewhere = await r.ideaf('change', b, '--json')
    expect(elsewhere.exit).toBe(1)
    expect(elsewhere.json().error).toMatchObject({
      code: 'other_worktree',
      details: { worktree: wt, branch: 'feat-b' },
    })
    expect(r.git('branch', '--show-current')).toBe('main')
    const gitDir = r.git('-C', wt, 'rev-parse', '--absolute-git-dir')
    expect((await readFile(join(gitDir, 'ideaf-active'), 'utf8')).trim()).toBe(b)
  })

  test("pulls an idea that isn't in this repository yet", async () => {
    await api(h('riley')).me({})
    const { idea } = await api(h('maya')).createIdea({
      title: `Maya's ${run}`,
      files: [{ path: 'docs/m.md', content: '# M\n' }],
    })
    await api(h('maya')).setAccess({
      idea,
      subject: { kind: 'user', id: h('riley') },
      access: { edit: false, share: false },
    })
    const r = await repo({}, { token: token(h('riley')) })
    const changed = await r.ideaf('change', idea, '--json')
    expect(changed.exit).toBe(0)
    expect(changed.json()).toMatchObject({ idea, pulled: true, version: 1, branch: 'main' })
    expect(await r.read('docs/m.md')).toBe('# M\n')
    expect(await activeOf(r)).toBe(idea)
    expect((await r.ideaf('change', 'i-not-there')).exit).toBe(5)
  })
})

describe('choosing the idea', () => {
  test('by --title: this repository first, then the server; ambiguous names refused without a terminal', async () => {
    const { r, a } = await twoBranches()
    r.git('switch', '-q', 'main')
    expect((await r.ideaf('change', '--title', 'ALPHA', '--json')).json().idea).toBe(a)

    const both = await r.ideaf('change', '--title', 'plan', '--json')
    expect(both.exit).toBe(2)
    expect(both.json().error).toMatchObject({ code: 'choose', details: { ideas: [{}, {}] } })

    const word = `narwhal${run}`
    const { idea } = await api(h('riley')).createIdea({
      title: `Remote ${word}`,
      files: [{ path: 'r.md', content: '# R\n' }],
    })
    expect((await r.ideaf('change', '--title', word, '--json')).json()).toMatchObject({ idea, pulled: true })
    expect((await r.ideaf('change', '--title', `nothing${run}`)).exit).toBe(5)
    expect((await r.ideaf('change', a, '--title', 'alpha')).exit).toBe(2)
  })

  test('from a list, when a person is at a terminal', async () => {
    const answers: string[] = []
    const { r, a } = await twoBranches(answers)
    answers.push('2')
    const picked = await r.ideaf('change')
    expect(picked.exit).toBe(0)
    expect(picked.out).toMatch(/ 1\) Plan beta .*\(this working tree’s, on feat-b\)/)
    expect(picked.out).toContain('Which idea? [1-2]')
    expect(picked.out).toContain(`Now on "Plan alpha" (${a}), on branch main.`)

    answers.push('9')
    expect((await r.ideaf('change')).exit).toBe(2)
    // with --json, never a prompt
    expect((await r.ideaf('change', '--json')).json().error.code).toBe('choose')
  })
})
