// How a git hint names a repository: the same for every way its remote is written.
import { expect, test } from 'bun:test'
import { repoUri } from './workspace.ts'

test('https and ssh remotes of one repository give the same uri', () => {
  expect(repoUri('https://github.com/acme/plans.git')).toBe('github.com/acme/plans')
  expect(repoUri('git@github.com:acme/plans.git')).toBe('github.com/acme/plans')
  expect(repoUri('github.com:acme/plans')).toBe('github.com/acme/plans')
  expect(repoUri('ssh://git@GitHub.com:22/acme/plans')).toBe('github.com/acme/plans')
  expect(repoUri('https://github.com/acme/plans/')).toBe('github.com/acme/plans')
  expect(repoUri('https://github.com/acme/other.git')).toBe('github.com/acme/other')
})

test('credentials never make it into the uri', () => {
  expect(repoUri('https://ghp_token@github.com/acme/plans.git')).toBe('github.com/acme/plans')
  expect(repoUri('https://me:secret@example.com/plans.git')).toBe('example.com/plans')
})

test('a local remote is its path', () => {
  expect(repoUri('/srv/git/plans.git')).toBe('/srv/git/plans')
  expect(repoUri('file:///srv/git/plans.git')).toBe('/srv/git/plans')
})
