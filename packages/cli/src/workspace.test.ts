import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { IdeaBusy, openWorkspace, withIdeaLock } from './workspace.ts'

async function workspace() {
  const ws = openWorkspace(await mkdtemp(join(tmpdir(), 'ideaf-lock-')))
  const lock = join(ws.stateDir, 'i1.lock')
  return { ws, lock }
}

describe('the idea lock', () => {
  test('is held for the whole command and removed afterwards', async () => {
    const { ws, lock } = await workspace()
    const seen = await withIdeaLock(ws, 'i1', async () => existsSync(lock))
    expect(seen).toBe(true)
    expect(existsSync(lock)).toBe(false)
  })

  test('a second command waits for the first', async () => {
    const { ws } = await workspace()
    const order: string[] = []
    const first = withIdeaLock(ws, 'i1', async () => {
      order.push('first starts')
      await new Promise((r) => setTimeout(r, 150))
      order.push('first ends')
    })
    await new Promise((r) => setTimeout(r, 20))
    const second = withIdeaLock(ws, 'i1', async () => {
      order.push('second runs')
    })
    await Promise.all([first, second])
    expect(order).toEqual(['first starts', 'first ends', 'second runs'])
  })

  test('gives up after waiting, naming who holds it', async () => {
    const { ws, lock } = await workspace()
    await withIdeaLock(ws, 'i1', async () => {
      const error = await withIdeaLock(ws, 'i1', async () => 'ran', 150).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(IdeaBusy)
      expect((error as IdeaBusy).holder).toMatchObject({ pid: process.pid, host: hostname() })
      expect(existsSync(lock)).toBe(true)
    })
  })

  test('takes over a lock whose process is gone', async () => {
    const { ws, lock } = await workspace()
    await withIdeaLock(ws, 'i1', async () => {}) // creates the state folder
    await writeFile(lock, JSON.stringify({ pid: 2_147_483_646, host: hostname(), at: Date.now() }))
    expect(await withIdeaLock(ws, 'i1', async () => 'ran', 100)).toBe('ran')
    expect(existsSync(lock)).toBe(false)
  })

  test("doesn't take over a fresh lock from another machine", async () => {
    const { ws, lock } = await workspace()
    await withIdeaLock(ws, 'i1', async () => {})
    await writeFile(lock, JSON.stringify({ pid: 1, host: 'some-other-machine', at: Date.now() }))
    await expect(withIdeaLock(ws, 'i1', async () => 'ran', 100)).rejects.toBeInstanceOf(IdeaBusy)
    expect(JSON.parse(await readFile(lock, 'utf8')).host).toBe('some-other-machine')
  })
})
