import { expect, test } from 'bun:test'

test('the engine image is the engine version RivetKit is pinned to', async () => {
  const lock = await Bun.file(new URL('../bun.lock', import.meta.url)).text()
  const dockerfile = await Bun.file(new URL('engine.Dockerfile', import.meta.url)).text()
  const pinned = lock.match(/"@rivetkit\/engine-cli@([^"]+)"/)?.[1]
  const image = dockerfile.match(/^FROM rivetdev\/engine:([^@\s]+)/m)?.[1]
  expect(pinned).toBeDefined()
  expect(image).toBe(pinned)
})
