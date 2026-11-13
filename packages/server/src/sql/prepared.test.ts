import { expect, test } from 'bun:test'
import type { Kysely } from 'kysely'
import { sqliteKysely } from './kysely.ts'
import { prepared } from './prepared.ts'
import { bunSql } from './sql-bun.ts'

type DB = { t: { id: string; kind: string; n: number } }

async function db() {
  const sql = bunSql()
  await sql.execute('CREATE TABLE t (id TEXT PRIMARY KEY, kind TEXT NOT NULL, n INTEGER NOT NULL)')
  await sql.execute("INSERT INTO t VALUES ('a', 'x', 1), ('b', 'x', 2), ('c', 'y', 3)")
  return { sql, kysely: sqliteKysely<DB>(sql) }
}

test('built once per shape, run with each call’s values', async () => {
  const { kysely } = await db()
  let builds = 0
  const byKind = prepared<{ kind: string; above?: number }>()((d: Kysely<DB>, slot) => {
    builds++
    let q = d.selectFrom('t').select('id').where('kind', '=', slot.kind)
    if (slot.above !== undefined) {
      q = q.where('n', '>', slot.above)
    }
    return q.orderBy('id')
  })
  expect(await byKind(kysely, { kind: 'x' })).toEqual([{ id: 'a' }, { id: 'b' }])
  expect(await byKind(kysely, { kind: 'y' })).toEqual([{ id: 'c' }])
  expect(builds).toBe(1)
  // another shape: built once more, then kept too
  expect(await byKind(kysely, { kind: 'x', above: 1 })).toEqual([{ id: 'b' }])
  expect(await byKind(kysely, { kind: 'x', above: 0 })).toEqual([{ id: 'a' }, { id: 'b' }])
  expect(builds).toBe(2)
})

test('the same query runs on another instance of the dialect (a transaction’s)', async () => {
  const { sql, kysely } = await db()
  const one = prepared<{ id: string }>()((d: Kysely<DB>, slot) =>
    d.selectFrom('t').select('n').where('id', '=', slot.id),
  )
  expect(await one(kysely, { id: 'a' })).toEqual([{ n: 1 }])
  await sql.transaction(async (tx) => {
    expect(await one(sqliteKysely<DB>(tx), { id: 'c' })).toEqual([{ n: 3 }])
  })
})

test('a value used as a list, which changes the SQL with its length, fails the first time it runs', async () => {
  const { kysely } = await db()
  const listed = prepared<{ ids: string[] }>()((d: Kysely<DB>, slot) =>
    d.selectFrom('t').select('id').where('id', 'in', slot.ids),
  )
  // its marker is one value, so the SQL reads `in ?`, which the database refuses
  await expect(listed(kysely, { ids: ['a', 'b'] })).rejects.toThrow()
})

test('a flag (true) picks the shape without being sent', async () => {
  const { kysely } = await db()
  const ordered = prepared<{ kind: string; newestFirst?: true }>()((d: Kysely<DB>, slot) =>
    d
      .selectFrom('t')
      .select('id')
      .where('kind', '=', slot.kind)
      .orderBy('n', slot.newestFirst !== undefined ? 'desc' : 'asc'),
  )
  expect(await ordered(kysely, { kind: 'x' })).toEqual([{ id: 'a' }, { id: 'b' }])
  expect(await ordered(kysely, { kind: 'x', newestFirst: true })).toEqual([{ id: 'b' }, { id: 'a' }])
})
