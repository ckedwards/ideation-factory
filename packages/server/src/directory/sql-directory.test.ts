import { expect, test } from 'bun:test'
import { bunSql } from '../sql/sql-bun.ts'
import { directoryContract } from './contract.ts'
import { migrateDirectory } from './schema.ts'
import { fts5Search } from './search.ts'
import { SqlDirectory } from './sql-directory.ts'
import { HANDLE_PARKED_MS } from './types.ts'

directoryContract('SqlDirectory on SQLite', async (options = {}) => {
  const sql = bunSql()
  const search = fts5Search()
  await migrateDirectory(sql, [search.migrate])
  return new SqlDirectory({ sql, search, ...options })
})

test('a search that matches more than the work cap uses the most recently updated matches and says it is incomplete', async () => {
  const sql = bunSql()
  const search = fts5Search()
  await migrateDirectory(sql, [search.migrate])
  const d = new SqlDirectory({ sql, search, searchCap: 50 })
  const row = (id: string, title: string, owner = 'u-a') => ({
    id,
    title,
    description: '',
    team: null,
    owner,
    status: 'draft',
    latest: 1,
    createdAt: 1,
    updatedAt: 1,
  })
  for (let i = 0; i < 49; i++) {
    await d.registerIdea(row(`few-${i}`, `Rare plan ${i}`))
  }
  expect(await d.searchIdeas('u-a', 'rare')).toMatchObject({ incomplete: false })
  for (let i = 0; i < 100; i++) {
    await d.registerIdea(row(`many-${i}`, `Common plan ${i}`))
  }
  const result = await d.searchIdeas('u-a', 'plan', 100)
  expect(result.incomplete).toBe(true)
  expect(result.items).toHaveLength(50)
  // narrowing the search brings it under the cap again
  expect(await d.searchIdeas('u-a', 'common plan', 100)).toMatchObject({ incomplete: true })
  expect(await d.searchIdeas('u-a', 'rare plan', 100)).toMatchObject({ incomplete: false })
})

test('a handle someone left is kept for them for 90 days, then anyone can take it', async () => {
  const sql = bunSql()
  const search = fts5Search()
  await migrateDirectory(sql, [search.migrate])
  let clock = 1_000_000
  const d = new SqlDirectory({ sql, search, now: () => clock })
  await d.ensureUser({ id: 'u-riley', handle: 'riley', name: 'Riley' })
  await d.updateUser('u-riley', { handle: 'rpark' })
  expect(await d.parkedUntil('user', 'riley', null)).toBe(1_000_000 + HANDLE_PARKED_MS)
  expect(await d.parkedUntil('user', 'riley', 'u-riley')).toBeNull()
  clock += HANDLE_PARKED_MS
  expect(await d.parkedUntil('user', 'riley', null)).toBeNull()
  // still leading to them until someone takes it
  expect((await d.user('riley'))!.id).toBe('u-riley')
})
