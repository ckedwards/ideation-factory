import { expect, test } from 'bun:test'
import { bunSql } from '../sql/sql-bun.ts'
import { directoryContract } from './contract.ts'
import { migrateDirectory } from './schema.ts'
import { fts5Search } from './search.ts'
import { SqlDirectory } from './sql-directory.ts'

directoryContract('SqlDirectory on SQLite', async () => {
  const sql = bunSql()
  const search = fts5Search()
  await migrateDirectory(sql, [search.migrate])
  return new SqlDirectory({ sql, search })
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
