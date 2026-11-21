/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { fitNotes, layoutNotes, unitHeight } from './gutter.ts'

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
        10,
      ),
    ).toEqual({ a: 0, b: 110, c: 170 })
  })

  test('a note whose text is in view goes no higher than the floor, and pushes the next one down', () => {
    expect(
      tops(
        [
          { id: 'a', anchor: 0, end: 20, height: 50 },
          { id: 'b', anchor: 120, end: 140, height: 50 },
          { id: 'c', anchor: 400, height: 50 },
        ],
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
        10,
        { top: 250, window: 200 },
      ),
    ).toEqual({ a: 0, b: 300 })
  })
})

describe('fitting notes to the page', () => {
  const heights = { short: 80, line: 30, pileStep: 6, lineGap: 10 }
  const sizes = (units: ReturnType<typeof fitNotes>) => units.map((u) => `${u.ids.join('+')}:${u.size}`)

  test('notes with room stay full', () => {
    expect(
      sizes(
        fitNotes(
          [
            { id: 'a', anchor: 0, full: 100 },
            { id: 'b', anchor: 300, full: 100 },
          ],
          heights,
          10,
          48,
        ),
      ),
    ).toEqual(['a:full', 'b:full'])
  })

  test('a crowded stretch steps down together until its last note is near its text; a quiet one stays full', () => {
    const notes = [
      { id: 'a', anchor: 0, full: 100 },
      { id: 'b', anchor: 20, full: 100 },
      { id: 'c', anchor: 40, full: 100 },
      { id: 'd', anchor: 1000, full: 100 },
    ]
    // full: c sits 180 below its text; short: 140 below; line: 40 below, within two lines
    expect(sizes(fitNotes(notes, heights, 10, 48))).toEqual(['a:line', 'b:line', 'c:line', 'd:full'])
  })

  test('a run that doesn’t fit as lines becomes one pile', () => {
    const notes = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, anchor: i * 2, full: 100 }))
    expect(sizes(fitNotes(notes, heights, 10, 48))).toEqual(['n0+n1+n2+n3+n4+n5:pile'])
  })

  test('the pile’s height counts up to three notes under its top one', () => {
    expect(unitHeight({ ids: ['a', 'b'], size: 'pile' }, () => 0, heights)).toBe(36)
    expect(unitHeight({ ids: ['a', 'b', 'c', 'd', 'e', 'f'], size: 'pile' }, () => 0, heights)).toBe(48)
  })

  test('a note stepped down with a run it was pushed into grows back once it has room', () => {
    const notes = [
      { id: 'a', anchor: 0, full: 100 },
      { id: 'b', anchor: 20, full: 100 },
      { id: 'c', anchor: 40, full: 100 },
      // pushed by the run while it's full, level with its text once the run is lines
      { id: 'd', anchor: 200, full: 100 },
    ]
    expect(sizes(fitNotes(notes, heights, 10, 48))).toEqual(['a:line', 'b:line', 'c:line', 'd:full'])
  })

  test('lines sit closer together than cards', () => {
    const notes = Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, anchor: i * 2, full: 100 }))
    // as lines 30 tall, 4 apart: the last sits 102 below the first, 96 below its text
    expect(sizes(fitNotes(notes, { ...heights, lineGap: 4 }, 12, 100))).toEqual([
      'n0:line',
      'n1:line',
      'n2:line',
      'n3:line',
    ])
  })
})
