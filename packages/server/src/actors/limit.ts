// A limit on how many calls this node has in flight to the directory actor.
// With many calls waiting on one actor, RivetKit's native runtime spends its
// CPU on its own locks (threads waking each other through contended futexes)
// instead of the calls: measured on the directory, 6 ms of CPU a write with 4
// in flight, 89 ms with 16 and 372 ms with 64 held for minutes, and fewer
// writes a second, not more. Calls waiting their turn here cost nothing.
import type { Client } from 'rivetkit/client'
import type { Registry } from '../registry.ts'

/**
 * Handle members used as they are: not calls; a queue message (send), which
 * waits on an actor's run loop rather than on a call it serves; or a call the
 * directory batches (actors/batch.ts), which would only shrink its batches if
 * it held a place here.
 */
const NOT_LIMITED = new Set<PropertyKey>([
  'connect',
  'resolve',
  'getGatewayUrl',
  'webSocket',
  'fetch',
  'send',
  // batched in the directory (actors/batch.ts): held back here, they couldn't share a commit
  'register',
  'notify',
  'index',
])

/** At most `limit` of `work` running at once; the rest wait their turn, in order. */
export function limiter(limit: number) {
  let running = 0
  const waiting: Array<() => void> = []
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (running < limit) {
      running++
    } else {
      // a finished call hands its place straight to the next
      await new Promise<void>((resolve) => waiting.push(resolve))
    }
    try {
      return await work()
    } finally {
      const next = waiting.shift()
      if (next) {
        next()
      } else {
        running--
      }
    }
  }
}

/** `actors`, with every call to the directory through it limited to `limit` in flight at once. */
export function limitDirectoryCalls(actors: Client<Registry>, limit: number): Client<Registry> {
  const turn = limiter(limit)
  const limited = <H extends object>(handle: H): H =>
    new Proxy(handle, {
      get(target, key) {
        // not a promise, whatever action names the handle answers to
        if (key === 'then') {
          return undefined
        }
        const value: unknown = Reflect.get(target, key)
        if (typeof value !== 'function' || NOT_LIMITED.has(key)) {
          return value
        }
        // Reflect.apply, not value.apply: an action is a proxy too, and any property read off it
        // (apply, bind, call) is taken as a nested action's name
        return (...args: unknown[]) => turn(() => Reflect.apply(value, target, args) as Promise<unknown>)
      },
    })
  const directory = new Proxy(actors.directory, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key)
      if (typeof value !== 'function') {
        return value
      }
      if (key === 'get' || key === 'getOrCreate') {
        return (...args: unknown[]) => limited(Reflect.apply(value, target, args) as object)
      }
      return value
    },
  })
  return new Proxy(actors, {
    get: (target, key) => (key === 'directory' ? directory : Reflect.get(target, key)),
  })
}
