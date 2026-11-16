import { expect, test } from 'bun:test'
import { bunSql } from '../sql/sql-bun.ts'
import { directoryContract } from './contract.ts'
import { migrateDirectory } from './schema.ts'
import { fts5Search, migrateSearch } from './search.ts'
import { SqlDirectory } from './sql-directory.ts'
import { HANDLE_PARKED_MS } from './types.ts'

/** The search index in a database of its own, as the search actor has it. */
async function searchIndex() {
  const searchSql = bunSql()
  await migrateSearch(searchSql)
  return { search: fts5Search(searchSql), searchSql }
}

directoryContract('SqlDirectory on SQLite', async (options = {}) => {
  const sql = bunSql()
  const { search } = await searchIndex()
  await migrateDirectory(sql)
  return new SqlDirectory({ sql, search, ...options })
})

test('a search that matches more than the work cap uses the most recently updated matches and says it is incomplete', async () => {
  const sql = bunSql()
  const { search } = await searchIndex()
  await migrateDirectory(sql)
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
  const { search } = await searchIndex()
  await migrateDirectory(sql)
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

test("an idea's search row is replaced, not added to, when its title changes, and found without reading every row", async () => {
  const sql = bunSql()
  const { search, searchSql } = await searchIndex()
  await migrateDirectory(sql)
  const d = new SqlDirectory({ sql, search })
  const base = { description: '', team: null, owner: 'u-a', status: 'draft', latest: 1, createdAt: 1, updatedAt: 1 }
  await d.registerIdea({ ...base, id: 'i1', title: 'Offline sync' })
  await d.registerIdea({ ...base, id: 'i2', title: 'Billing' })
  await d.updateIdea({
    id: 'i1',
    title: 'Field app',
    description: '',
    status: 'draft',
    latest: 2,
    openComments: 0,
    approvers: [],
    updatedAt: 2,
  })
  expect((await d.searchIdeas('u-a', 'offline')).items).toEqual([])
  expect((await d.searchIdeas('u-a', 'field')).items.map((i) => i.id)).toEqual(['i1'])
  expect(await searchSql.execute('SELECT id FROM idea_search ORDER BY rowid')).toEqual([{ id: 'i2' }, { id: 'i1' }])
  // the row is looked up by the idea, through an index: not a scan of the search table
  const plan = await searchSql.execute<{ detail: string }>(
    "EXPLAIN QUERY PLAN SELECT row FROM search_rows WHERE idea = 'i1'",
  )
  expect(plan.map((p) => p.detail).join(' ')).toContain('USING INDEX')
})

test('when email is due is read off indexes, never the whole queue', async () => {
  const sql = bunSql()
  await migrateDirectory(sql)
  const plan = async (query: string) =>
    (await sql.execute<{ detail: string }>(`EXPLAIN QUERY PLAN ${query}`)).map((p) => p.detail).join(' | ')
  // the next due time: the minimum of each index
  expect(await plan('SELECT min("last") FROM email_queue WHERE daily = 0')).toContain('email_queue_last')
  expect(await plan('SELECT min("first") FROM email_queue WHERE daily = 0')).toContain('email_queue_first')
  // what's due now: ranges of both, not a scan of the table
  const due = await plan(
    'SELECT "user", idea, "first", "last" FROM email_queue WHERE daily = 0 AND ("last" <= 100 OR "first" <= 50)',
  )
  expect(due).toContain('email_queue_last')
  expect(due).toContain('email_queue_first')
  expect(due).not.toMatch(/SCAN email_queue(?! USING)/)
})
