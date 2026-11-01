// Remote URLs: what's safe to send to the server, and telling one remote from another.
import { expect, test } from 'bun:test'
import { publicRemote, remoteKey } from './workspace.ts'

test('credentials never leave the machine; ssh users stay', () => {
  expect(publicRemote('https://ghp_token@github.com/acme/plans.git')).toBe('https://github.com/acme/plans.git')
  expect(publicRemote('https://me:secret@example.com/plans.git')).toBe('https://example.com/plans.git')
  expect(publicRemote('ssh://me:secret@example.com/plans.git')).toBe('ssh://me@example.com/plans.git')
  expect(publicRemote('ssh://git@github.com/acme/plans.git')).toBe('ssh://git@github.com/acme/plans.git')
  expect(publicRemote('git@github.com:acme/plans.git')).toBe('git@github.com:acme/plans.git')
})

test('the same remote written different ways is the same remote', () => {
  const key = remoteKey('https://github.com/acme/plans.git')
  expect(remoteKey('git@github.com:acme/plans.git')).toBe(key)
  expect(remoteKey('ssh://git@GitHub.com:22/acme/plans')).toBe(key)
  expect(remoteKey('https://github.com/acme/plans/')).toBe(key)
  expect(remoteKey('https://github.com/acme/other.git')).not.toBe(key)
  expect(remoteKey('/srv/git/plans.git')).toBe(remoteKey('/srv/git/plans'))
})
