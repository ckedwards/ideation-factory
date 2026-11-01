// ideaf change, end to end: switching ideas and their branches, worktrees,
// ideas not in the repository yet, --title, and the picker.
import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
    expect(picked.out).toContain('? Which idea?')
    expect(picked.out).toMatch(/ 1\) Plan beta .*\(this working tree’s, on feat-b\)/)
    expect(picked.out).toMatch(/ 2\) Plan alpha /)
    expect(picked.out).toContain(`Now on "Plan alpha" (${a}), on branch main.`)

    answers.push('9')
    expect((await r.ideaf('change')).exit).toBe(2)
    // with --json, never a prompt
    expect((await r.ideaf('change', '--json')).json().error.code).toBe('choose')
  })
})

describe('on another machine', () => {
  /** A shared remote, and a first machine that started an idea on its own branch and pushed it. */
  async function pushed() {
    const origin = await mkdtemp(join(tmpdir(), 'ideaf-origin-'))
    Bun.spawnSync(['git', 'init', '-q', '--bare', '-b', 'main', origin])
    const first = await repo({ 'README.md': '# Readme\n' }, { token: token(h('riley')) })
    first.git('add', '.')
    first.git('commit', '-qm', 'first')
    first.git('remote', 'add', 'origin', origin)
    first.git('push', '-q', 'origin', 'main')
    await first.write('docs/plan.md', '# Plan\n')
    const { idea } = (
      await first.ideaf('start', 'docs', '--title', 'Travelling', '--branch', 'idea/travel', '--json')
    ).json()
    first.git('add', '.')
    first.git('commit', '-qm', 'plan')
    first.git('push', '-q', '-u', 'origin', 'idea/travel')
    return { origin, first, idea: idea as string }
  }

  /** A second machine: a fresh clone of the remote. */
  async function clone(origin: string) {
    const second = await repo({}, { git: false, token: token(h('riley')) })
    second.git('clone', '-q', origin, '.')
    second.git('config', 'user.email', 'e2e@example.com')
    second.git('config', 'user.name', 'E2E')
    return second
  }

  test("the server knows the idea's branch and remote, and change fetches that branch and switches to it", async () => {
    const { origin, idea } = await pushed()
    expect((await api(h('riley')).getIdea({ idea })).git).toEqual({ remote: origin, branch: 'idea/travel' })

    const second = await clone(origin)
    expect(second.git('branch', '--show-current')).toBe('main')
    const changed = await second.ideaf('change', idea, '--json')
    expect(changed.exit).toBe(0)
    expect(changed.json()).toMatchObject({ idea, branch: 'idea/travel', switched: true, pulled: true, changes: [] })
    expect(second.git('branch', '--show-current')).toBe('idea/travel')
    expect(second.git('rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/idea/travel')
    expect(await second.read('docs/plan.md')).toBe('# Plan\n')
    expect((await second.ideaf('sync', 'docs')).out).toBe('Nothing to sync.')
  })

  test('each sync moves where the server says it is; a remote this repository lacks just pulls here', async () => {
    const { first, idea } = await pushed()
    first.git('switch', '-qc', 'idea/renamed')
    await first.write('docs/plan.md', '# Plan\n\nMore.\n')
    expect((await first.ideaf('sync', 'docs')).exit).toBe(0)
    expect((await api(h('riley')).getIdea({ idea })).git).toMatchObject({ branch: 'idea/renamed' })

    const unrelated = await repo({}, { token: token(h('riley')) })
    const changed = await unrelated.ideaf('change', idea)
    expect(changed.exit).toBe(0)
    expect(changed.out).toContain("which isn't a remote of this repository, so it's pulled onto main")
    expect(await unrelated.read('docs/plan.md')).toBe('# Plan\n\nMore.\n')
  })
})
