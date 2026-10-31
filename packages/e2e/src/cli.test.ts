// The cli end to end, against the real server, in temporary git repositories.
import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { api, repo, server } from './harness.ts'

beforeAll(() => server(), 60_000)

const PLAN = `# Plan

We should ship the offline mode this quarter.

## Risks

It might rain on launch day.

## Timeline

Two weeks.
`

describe('the first milestone: a walking skeleton', () => {
  test('start, comment, edit with a batch that moves and rewords a section, and pull: the comment follows', async () => {
    const r = await repo({ 'docs/plan.md': PLAN, 'src/app.ts': 'code, not part of the idea' })

    // 1. start an idea from the folder of Markdown
    const started = await r.ideaf('start', 'docs', '--title', 'Offline mode', '--json')
    expect(started.exit).toBe(0)
    const { idea } = started.json()
    expect(started.json().files).toEqual([{ file: 'f1', path: 'docs/plan.md' }])
    expect(existsSync(join(r.dir, '.git', 'ideaf', `${idea}.json`))).toBe(true)

    // 2. a reviewer comments on a section and on its text, through the API
    const blocks = (await r.ideaf('show', '--blocks', '--json')).json()
    const risks = blocks.files[0].entries.find((e: { source: string }) => e.source === '## Risks').id
    const timeline = blocks.files[0].entries.find((e: { source: string }) => e.source === '## Timeline').id
    const riskBlock = blocks.files[0].entries.find((e: { section: string }) => e.section === risks).id
    const reviewer = api()
    const onSection = await reviewer.addComment({ idea, version: 1, anchor: { kind: 'section', section: risks }, body: 'Move risks after the timeline?' })
    const plain = 'Plan\nWe should ship the offline mode this quarter.\nRisks\nIt might rain on launch day.'
    const start = plain.indexOf('rain on launch day')
    const onText = await reviewer.addComment({ idea, version: 1, anchor: { kind: 'text', file: 'f1', start, end: start + 'rain on launch day'.length }, body: 'Which risk?' })

    // 3. edit with a batch that moves the section and rewords it; dry run first
    const batch = {
      steps: [
        { command: 'move', target: risks, to: { after: timeline }, addresses: [onSection.comment] },
        { command: 'replace', in: riskBlock, old: 'rain on launch day', new: 'storm during the launch window', addresses: [onText.comment] },
      ],
    }
    await r.write('batch.json', JSON.stringify(batch))
    const dry = await r.ideaf('edit', 'batch.json', '--dry-run')
    expect(dry.exit).toBe(0)
    expect(dry.out).toContain('+It might storm during the launch window.')
    expect(dry.out).toContain('Dry run: nothing changed.')
    const edited = await r.ideaf('edit', 'batch.json', '--json')
    expect(edited.exit).toBe(0)
    expect(edited.json().version).toBe(2)

    // the comments followed the edit
    const comments = await reviewer.listComments({ idea })
    expect(comments.map((c) => [c.id, c.state, c.anchor?.kind === 'text' ? c.anchor.quote : c.anchor?.kind, c.addressedIn])).toEqual([
      [onSection.comment, 'moved', 'section', [2]],
      [onText.comment, 'changed', 'storm during the launch window', [2]],
    ])

    // 4. pull the result into the repository
    const pulled = await r.ideaf('pull')
    expect(pulled.exit).toBe(0)
    expect(await r.read('docs/plan.md')).toBe(`# Plan

We should ship the offline mode this quarter.

## Timeline

Two weeks.

## Risks

It might storm during the launch window.
`)
    expect((await r.ideaf('sync')).out).toBe('Nothing to sync.')
  })
})

describe('sync', () => {
  test('uploads only what changed, with its base, and refuses with "pull first" if the idea moved on', async () => {
    const r = await repo({ 'plan.md': PLAN, 'notes.md': '# Notes\n' })
    const started = (await r.ideaf('start', '--title', 'Sync', '--json')).json()
    const idea = started.idea
    // files are scanned in sorted order: notes.md is f1, plan.md f3
    const planFile = started.files.find((f: { path: string }) => f.path === 'plan.md').file

    await r.write('plan.md', PLAN.replace('Two weeks.', 'Three weeks.'))
    const synced = await r.ideaf('sync', '--json')
    expect(synced.exit).toBe(0)
    expect(synced.json()).toMatchObject({ version: 2, uploaded: ['plan.md'], deleted: [] })

    // someone edits remotely; a local sync from the old base is refused
    await api().edit({ idea, batch: { base: 2, steps: [{ command: 'insert', at: { end: planFile }, markdown: 'Remote line.' }] } })
    await r.write('plan.md', PLAN.replace('Two weeks.', 'Four weeks.'))
    const stale = await r.ideaf('sync')
    expect(stale.exit).toBe(3)
    expect(stale.err).toContain('Run `ideaf pull`')

    // pull merges the remote edit with the local one, then sync works
    const pulled = await r.ideaf('pull')
    expect(pulled.exit).toBe(0)
    const merged = await r.read('plan.md')
    expect(merged).toContain('Four weeks.')
    expect(merged).toContain('Remote line.')
    expect((await r.ideaf('sync', '--json')).json()).toMatchObject({ version: 4 })
  })

  test('new, renamed and deleted files', async () => {
    const r = await repo({ 'a.md': '# A\n', 'b.md': '# B\n' })
    const { idea } = (await r.ideaf('start', '--title', 'Files', '--json')).json()
    r.git('add', '.')
    r.git('mv', 'a.md', 'renamed.md')
    await r.write('c.md', '# C\n')
    await Bun.write(join(r.dir, 'b.md'), '')
    Bun.spawnSync(['rm', join(r.dir, 'b.md')])
    const synced = await r.ideaf('sync', '--json')
    expect(synced.exit).toBe(0)
    const files = (await api().pull({ idea })).files.map((f) => [f.file, f.path])
    // the renamed file keeps its ID, so its comments would follow it
    expect(files).toEqual([
      ['f1', 'renamed.md'],
      ['f5', 'c.md'],
    ])
  })
})

describe('pull', () => {
  test('merges local and remote edits to different parts of a file', async () => {
    const r = await repo({ 'plan.md': PLAN })
    const { idea } = (await r.ideaf('start', '--title', 'Merge', '--json')).json()
    await api().edit({ idea, batch: { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'this quarter', new: 'next quarter' }] } })
    await r.write('plan.md', PLAN.replace('Two weeks.', 'Two weeks, maybe three.'))
    const pulled = await r.ideaf('pull', '--json')
    expect(pulled.exit).toBe(0)
    expect(pulled.json().changes).toEqual([{ path: 'plan.md', change: 'merged' }])
    expect(await r.read('plan.md')).toBe(PLAN.replace('this quarter', 'next quarter').replace('Two weeks.', 'Two weeks, maybe three.'))
  })

  test('leaves conflict markers when both sides changed the same line, and says so', async () => {
    const r = await repo({ 'plan.md': PLAN })
    const { idea } = (await r.ideaf('start', '--title', 'Conflict', '--json')).json()
    await api().edit({ idea, batch: { base: 1, steps: [{ command: 'replace', in: 'b3', old: 'this quarter', new: 'next quarter' }] } })
    await r.write('plan.md', PLAN.replace('this quarter', 'this month'))
    const pulled = await r.ideaf('pull')
    expect(pulled.exit).toBe(7)
    expect(pulled.out).toContain('Resolve the conflict markers in plan.md')
    const content = await r.read('plan.md')
    expect(content).toContain('<<<<<<< yours\nWe should ship the offline mode this month.\n=======\nWe should ship the offline mode next quarter.\n>>>>>>> v2')
  })

  test('on a new machine, writes the files and starts tracking them', async () => {
    const first = await repo({ 'plan.md': PLAN })
    const { idea } = (await first.ideaf('start', '--title', 'Two machines', '--json')).json()
    const second = await repo()
    const pulled = await second.ideaf('pull', '--idea', idea)
    expect(pulled.exit).toBe(0)
    expect(await second.read('plan.md')).toBe(PLAN)
    expect((await second.ideaf('sync')).out).toBe('Nothing to sync.')
  })
})

describe('edit', () => {
  test("refuses while there are local edits that aren't synced", async () => {
    const r = await repo({ 'plan.md': PLAN })
    await r.ideaf('start', '--title', 'Guard')
    await r.write('plan.md', `${PLAN}\nLocal edit.\n`)
    await r.write('batch.json', JSON.stringify({ steps: [{ command: 'delete', target: 'b7' }] }))
    const refused = await r.ideaf('edit', 'batch.json', '--json')
    expect(refused.exit).toBe(8)
    expect(refused.json()).toEqual({ error: { code: 'local_changes', message: expect.stringContaining('plan.md'), details: { files: ['plan.md'] } } })
  })

  test('a conflict names the steps that no longer apply', async () => {
    const r = await repo({ 'plan.md': PLAN })
    await r.ideaf('start', '--title', 'Conflict')
    await r.write('batch.json', JSON.stringify({ steps: [{ command: 'replace', in: 'b3', old: 'not there', new: 'x' }] }))
    const result = await r.ideaf('edit', 'batch.json')
    expect(result.exit).toBe(4)
    expect(result.err).toContain('step 0: "not there" isn\'t in b3')
  })

  test('a malformed batch is caught before anything is sent', async () => {
    const r = await repo({ 'plan.md': PLAN })
    await r.ideaf('start', '--title', 'Malformed')
    await r.write('batch.json', JSON.stringify({ steps: [{ command: 'shuffle', target: 'b3' }] }))
    const result = await r.ideaf('edit', 'batch.json')
    expect(result.exit).toBe(2)
    expect(result.err).toContain('the batch is malformed')
  })
})

describe('one ideaf at a time per idea', () => {
  test('two syncs at once: the second waits for the first, and nothing is uploaded twice', async () => {
    const r = await repo({ 'plan.md': PLAN })
    const { idea } = (await r.ideaf('start', '--title', 'Lock', '--json')).json()
    await r.write('plan.md', PLAN.replace('Two weeks.', 'Three weeks.'))
    const [a, b] = await Promise.all([r.ideaf('sync', '--json'), r.ideaf('sync', '--json')])
    expect([a.exit, b.exit]).toEqual([0, 0])
    expect([a.json().uploaded, b.json().uploaded].toSorted()).toEqual([[], ['plan.md']])
    expect((await api().getIdea({ idea })).latest).toBe(2)
  })

  test('a command that can\'t get the lock in time says who has it', async () => {
    const r = await repo({ 'plan.md': PLAN }, { env: { IDEAF_LOCK_WAIT_MS: '100' } })
    const { idea } = (await r.ideaf('start', '--title', 'Busy', '--json')).json()
    await r.write(`.git/ideaf/${idea}.lock`, JSON.stringify({ pid: 1, host: 'another-machine', at: Date.now() }))
    const result = await r.ideaf('sync')
    expect(result.exit).toBe(10)
    expect(result.err).toContain('another ideaf (pid 1 on another-machine)')
  })
})

describe('the basics', () => {
  test('without a token, every command says how to sign in', async () => {
    const r = await repo({ 'plan.md': PLAN }, { token: null })
    const result = await r.ideaf('start', '--title', 'No token')
    expect(result.exit).toBe(6)
    expect(result.err).toContain('set IDEAF_TOKEN')
  })

  test('outside a git repository, state lives in .ideaf/', async () => {
    const r = await repo({ 'plan.md': PLAN }, { git: false })
    const { idea } = (await r.ideaf('start', '--title', 'No git', '--json')).json()
    expect(existsSync(join(r.dir, '.ideaf', 'state', `${idea}.json`))).toBe(true)
  })

  test('commands before start explain what to do', async () => {
    const r = await repo({ 'plan.md': PLAN })
    const result = await r.ideaf('show', '--blocks')
    expect(result.exit).toBe(2)
    expect(result.err).toContain('run `ideaf start`')
  })
})
