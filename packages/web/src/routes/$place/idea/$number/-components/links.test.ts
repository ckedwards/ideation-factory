/// <reference types="bun" />
import { expect, test } from 'bun:test'
import { ideaLinks, parseRange } from './links.ts'

test("an idea's addresses, in its team or among someone's own", () => {
  const team = ideaLinks('mobile', 9)
  expect(team.overview).toBe('/mobile/idea/9')
  expect(team.files()).toBe('/mobile/idea/9/files')
  expect(team.files({ v: 2, file: 'docs/plan.md' })).toBe('/mobile/idea/9/files?file=docs%2Fplan.md&v=2')
  expect(team.changes(1, 3)).toBe('/mobile/idea/9/changes/1..3')
  expect(team.changes(1)).toBe('/mobile/idea/9/changes/1..')
  expect(ideaLinks('@riley', 3).overview).toBe('/@riley/idea/3')
})

test('a range runs forward from a version; anything else is no range', () => {
  expect(parseRange('1..3')).toEqual({ from: 1, to: 3 })
  expect(parseRange('2..')).toEqual({ from: 2, to: null })
  for (const bad of ['3..1', '2..2', '0..2', '..3', '1-3', 'BASE..3', '']) {
    expect(parseRange(bad)).toBeNull()
  }
})
