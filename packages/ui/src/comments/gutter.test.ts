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

  test('a note whose text is in view goes no higher than the floor, and pushes the next one down', () => {
    expect(
      tops(
        [
          { id: 'a', anchor: 0, end: 20, height: 50 },
          { id: 'b', anchor: 120, end: 140, height: 50 },
          { id: 'c', anchor: 400, height: 50 },
        ],
        null,
        10,
        { top: 100, window: 10 },
      ),
    ).toEqual({ a: 100, b: 160, c: 400 })
  })

  test('a note whose text has gone above the window is left where it was', () => {
    expect(
      tops(
        [
          { id: 'a', anchor: 0, end: 20, height: 50 },
          { id: 'b', anchor: 300, end: 320, height: 50 },
        ],
        null,
        10,
        { top: 250, window: 200 },
      ),
    ).toEqual({ a: 0, b: 300 })
  })

  test('the active note stays level with its text unless that would push one in view under the floor', () => {
    const notes = [
      { id: 'a', anchor: 100, end: 120, height: 100 },
      { id: 'b', anchor: 150, end: 170, height: 50 },
    ]
    // room above: pinned as before
    expect(tops(notes, 'b', 10, { top: 0, window: 0 })).toEqual({ a: 40, b: 150 })
    // none: as if nothing were active
    expect(tops(notes, 'b', 10, { top: 100, window: 0 })).toEqual({ a: 100, b: 210 })
  })
})
