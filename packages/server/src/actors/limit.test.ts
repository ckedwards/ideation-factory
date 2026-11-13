import { describe, expect, test } from 'bun:test'
import { startTestActors } from '../testing.ts'
import { DIRECTORY_KEY } from './directory.ts'
import { limiter, limitDirectoryCalls } from './limit.ts'

describe('a limit on calls in flight', () => {
  test('runs at most the limit at once, the rest in the order they came', async () => {
    const turn = limiter(2)
    let running = 0
    let most = 0
    const started: number[] = []
    const releases: Array<() => void> = []
    const calls = [0, 1, 2, 3, 4].map((n) =>
      turn(async () => {
        started.push(n)
        running++
        most = Math.max(most, running)
        await new Promise<void>((resolve) => releases.push(resolve))
        running--
        return n
      }),
    )
    for (let i = 0; i < 5; i++) {
      await Bun.sleep(5)
      releases.shift()?.()
    }
    expect(await Promise.all(calls)).toEqual([0, 1, 2, 3, 4])
    expect(most).toBe(2)
    expect(started).toEqual([0, 1, 2, 3, 4])
  })

  test('a call that fails gives its place to the next', async () => {
    const turn = limiter(1)
    const failing = turn(() => Promise.reject(new Error('no')))
    const next = turn(async () => 'next')
    await expect(failing).rejects.toThrow('no')
    expect(await next).toBe('next')
  })

  test('directory calls through the limited client reach the directory; other actors are untouched', async () => {
    const actors = await startTestActors()
    const limited = limitDirectoryCalls(actors, 2)
    const directory = limited.directory.getOrCreate(DIRECTORY_KEY)
    // actions (any name), with their arguments as they were
    expect(await directory.users(['nobody'])).toEqual([])
    expect(await Promise.all([1, 2, 3, 4, 5].map(() => directory.users([])))).toEqual([[], [], [], [], []])
    // a handle isn't mistaken for a promise
    expect(await Promise.resolve(directory)).toBe(directory)
    // other actors' handles come straight from the client (it makes a new accessor on each read)
    expect(Object.keys(limited.idea)).toEqual(Object.keys(actors.idea))
  })
})
