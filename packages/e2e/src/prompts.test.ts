// What a person at a terminal is asked, through the harness's scripted answers.
import { beforeAll, expect, test } from 'bun:test'
import { repo, server, token } from './harness.ts'

beforeAll(() => server(), 60_000)

const run = crypto.randomUUID().slice(0, 6)
const h = (name: string) => `${name}-${run}`

test('a missing title or name is asked for; cancelling the question stops', async () => {
  const answers = ['Asked for', 'The asked team']
  const r = await repo({ 'plan.md': '# P\n' }, { token: token(h('riley')), answers })
  const started = await r.ideaf('start')
  expect(started.out).toContain('? Title')
  expect(started.out).toContain('Started "Asked for"')
  expect((await r.ideaf('team', 'create', h('asked'))).out).toContain('? Name')
  expect((await r.ideaf('team', 'show', h('asked'))).out).toContain('The asked team')

  // no answer left: as if cancelled
  const cancelled = await r.ideaf('team', 'create', h('unnamed'))
  expect(cancelled.exit).toBe(2)
  expect(cancelled.err).toContain('needs a name')
})

test('moving asks to confirm, and no means nothing moves', async () => {
  const answers: string[] = []
  const r = await repo({ 'plan.md': '# P\n' }, { token: token(h('rowan')), answers })
  await r.ideaf('team', 'create', h('dest'), '--name', 'Dest')
  await r.ideaf('start', '--title', 'Moving')

  answers.push('n')
  const declined = await r.ideaf('move', '--team', h('dest'))
  expect(declined.exit).toBe(0)
  expect(declined.out).toContain('? Move it? [y/N]')
  expect(declined.out).toContain('Not moved.')
  expect((await r.ideaf('list', '--server', '--json')).json().items[0].team).toBeNull()

  answers.push('y')
  expect((await r.ideaf('move', '--team', h('dest'))).out).toContain(`Moved to team:${h('dest')}.`)
})
