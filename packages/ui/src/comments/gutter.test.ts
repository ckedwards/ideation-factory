/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { layoutNotes } from './gutter.ts'

const tops = (...args: Parameters<typeof layoutNotes>) => Object.fromEntries(layoutNotes(...args))

describe('notes in the gutter', () => {
  test('each sits level with its text when there’s room', () => {
    expect(
      tops([
        { id: 'a', anchor: 0, height: 50 },
        { id: 'b', anchor: 200, height: 50 },
      ]),
    ).toEqual({ a: 0, b: 200 })
  })

  test('one that would overlap the note above goes just below it', () => {
    expect(
      tops(
        [
          { id: 'b', anchor: 20, height: 50 },
          { id: 'a', anchor: 0, height: 100 },
          { id: 'c', anchor: 40, height: 10 },
        ],
        null,
        10,
      ),
    ).toEqual({ a: 0, b: 110, c: 170 })
  })

  test('the active note sits level with its text, and the notes above it make room', () => {
    expect(
      tops(
        [
          { id: 'a', anchor: 0, height: 100 },
          { id: 'b', anchor: 50, height: 100 },
          { id: 'c', anchor: 60, height: 20 },
        ],
        'b',
        10,
      ),
    ).toEqual({ a: -60, b: 50, c: 160 })
  })
})
