import { expect, test } from 'bun:test'
import { suggestHandle } from './handles.ts'

test("a handle from a team's or group's name", () => {
  expect(suggestHandle('Mobile')).toBe('mobile')
  expect(suggestHandle('Platform & Infra')).toBe('platform-infra')
  expect(suggestHandle('  Design Review  ')).toBe('design-review')
  expect(suggestHandle('Café Équipe')).toBe('cafe-equipe')
  expect(suggestHandle('2027 roadmap!')).toBe('2027-roadmap')
  expect(suggestHandle('—')).toBe('')
  expect(suggestHandle('a'.repeat(38) + ' b')).toBe('a'.repeat(38))
  expect(suggestHandle('x'.repeat(50))).toHaveLength(39)
})
