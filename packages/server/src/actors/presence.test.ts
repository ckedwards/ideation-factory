// Who's in a draft (presence.ts): windows, colors, the limit, sessions and expiry.
import { describe, expect, test } from 'bun:test'
import { DraftPresences, PRESENCE_TTL_MS } from './presence.ts'

const at = { file: 'f1', anchor: 7, head: 7, version: 3 }

describe('who is in a draft', () => {
  test('each window is its own, with the lowest color not taken, kept while it stays', () => {
    const p = new DraftPresences()
    expect(p.join('w-riley-1', 'riley', 's1', 20, 0)).toMatchObject({ joined: true, person: { color: 1 } })
    // the same person in a second window: another entity, another color
    expect(p.join('w-riley-2', 'riley', 's2', 20, 0)).toMatchObject({ joined: true, person: { color: 2 } })
    expect(p.join('w-priya-1', 'priya', 's3', 20, 0)).toMatchObject({ joined: true, person: { color: 3 } })
    expect(p.leave('w-riley-2', 's2')).toBe(true)
    // the color freed goes to the next to arrive; the others keep theirs
    expect(p.join('w-zoe-1', 'zoe', 's4', 20, 0)).toMatchObject({ joined: true, person: { color: 2 } })
    expect(p.people().map((q) => [q.window, q.color])).toEqual([
      ['w-riley-1', 1],
      ['w-priya-1', 3],
      ['w-zoe-1', 2],
    ])
  })

  test('past eight, colors repeat', () => {
    const p = new DraftPresences()
    const colors = Array.from({ length: 10 }, (_, i) => {
      const joined = p.join(`window-${i}`, `u${i}`, `s${i}`, 20, 0)
      return joined.joined ? joined.person.color : 0
    })
    expect(colors).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 1, 2])
  })

  test('past the limit a window is kept out, and let in once someone leaves', () => {
    const p = new DraftPresences()
    p.join('window-a', 'a', 'sa', 2, 0)
    p.join('window-b', 'b', 'sb', 2, 0)
    expect(p.join('window-c', 'c', 'sc', 2, 0)).toMatchObject({ joined: false, people: [{ window: 'window-a' }, {}] })
    p.leave('window-a', 'sa')
    expect(p.join('window-c', 'c', 'sc', 2, 0)).toMatchObject({ joined: true })
  })

  test('a reconnect takes the window over; the old socket closing late leaves it in', () => {
    const p = new DraftPresences()
    p.join('window-a', 'riley', 'old', 20, 0)
    expect(p.move('window-a', 'old', at, 1)).toMatchObject({ moved: true })
    // still there: nothing to tell anyone
    expect(p.move('window-a', 'old', { ...at }, 1)).toMatchObject({ moved: false })
    // back on a new socket: the same window, color and caret
    expect(p.join('window-a', 'riley', 'new', 20, 2)).toMatchObject({ joined: true, person: { color: 1, at } })
    expect(p.leave('window-a', 'old')).toBe(false)
    expect(p.move('window-a', 'old', null, 3)).toBeNull()
    expect(p.size).toBe(1)
    // someone else can't take a window over by its name
    expect(p.join('window-a', 'mallory', 'x', 20, 4)).toMatchObject({ joined: false })
  })

  test('a window not heard from is gone', () => {
    const p = new DraftPresences()
    p.join('window-a', 'a', 'sa', 20, 0)
    p.join('window-b', 'b', 'sb', 20, 0)
    p.move('window-b', 'sb', at, PRESENCE_TTL_MS - 1)
    expect(p.sweep(PRESENCE_TTL_MS + 1)).toEqual(['window-a'])
    expect(p.people().map((q) => q.window)).toEqual(['window-b'])
  })
})
