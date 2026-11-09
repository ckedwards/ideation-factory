// Sending an idea's outbox when the directory can't always take it: what it
// couldn't take is kept and sent later, without holding up the rest, and what
// it took is gone.
import { expect, test } from 'bun:test'
import { inProcessCore } from '../core-pool/runner.ts'
import { MemoryFileStore } from '../files/memory.ts'
import { DEFAULT_LIMITS } from '../limits.ts'
import { bunSql } from '../sql/sql-bun.ts'
import { sendOutbox } from './outbox.ts'
import { migrate } from './schema.ts'
import { type Caller, IdeaService } from './service.ts'

const OWNER: Caller = { user: 'riley', bot: null, purpose: 'me' }

test('one the directory couldn’t take is kept and sent later, without holding up the rest', async () => {
  const sql = bunSql()
  await migrate(sql)
  const clock = { now: 1_000 }
  const service = new IdeaService('idea-1', {
    sql,
    files: new MemoryFileStore(),
    core: inProcessCore(),
    limits: DEFAULT_LIMITS,
    now: () => clock.now,
  })
  let n = 0
  const write = (w: unknown) => service.write({ key: `k${++n}`, caller: OWNER, write: w })
  await write({ type: 'create', title: 'Plan', files: [{ path: 'plan.md', content: '# Plan\n\nText.\n' }] })
  await write({ type: 'status', status: 'requesting-review' })

  // the directory refuses the first (a throw) and takes the second
  const sent: string[] = []
  let refuse = true
  const send = async (batch: { id: string; events: Array<{ kind: string }> }) => {
    const kind = batch.events[0]!.kind
    if (kind === 'version' && refuse) {
      throw new Error('An internal error occurred')
    }
    sent.push(kind)
    return true
  }
  const logged: unknown[] = []
  const next = await sendOutbox(service, send, (f) => logged.push(f))
  expect(sent).toEqual(['status'])
  expect(await service.outboxSize()).toBe(1)
  expect(next).toBe(clock.now + 500)
  expect(logged).toHaveLength(1)

  // not due yet: nothing goes; once it is, and the directory takes it, it's gone
  refuse = false
  expect(await sendOutbox(service, send, () => {})).toBe(clock.now + 500)
  clock.now += 500
  expect(await sendOutbox(service, send, () => {})).toBeNull()
  expect(sent).toEqual(['status', 'version'])
  expect(await service.outboxSize()).toBe(0)

  // an answer of "not applied" is kept too
  await write({ type: 'status', status: 'draft' })
  expect(
    await sendOutbox(
      service,
      async () => false,
      () => {},
    ),
  ).toBe(clock.now + 500)
  expect(await service.outboxSize()).toBe(1)
})
