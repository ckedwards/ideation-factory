// Better Auth's dialect over the actor database: a transaction whose commit
// the engine refuses (its storage busy) is run again, once, and lands once;
// a rollback, or any other failure, isn't.
import { describe, expect, test } from 'bun:test'
import { Kysely } from 'kysely'
import { bunSql } from '../sql/sql-bun.ts'
import type { Sql } from '../sql/sql.ts'
import { ActorSqliteDialect } from './dialect.ts'

type DB = { notes: { id: string } }

const busy = () =>
  Object.assign(new Error('An internal error occurred'), {
    metadata: { error: 'sqlite storage is overloaded, retry after 50 ms: volume write refused before dispatch' },
  })

/** SQLite whose first `refusals` commits are refused, as the engine refuses them: nothing lands. */
async function refusing(refusals: number, error: () => Error = busy) {
  const base = bunSql()
  await base.execute('create table notes (id text primary key)')
  let commits = 0
  const sql: Sql = {
    execute: base.execute,
    transaction: (callback) =>
      base.transaction(async (tx) => {
        const result = await callback(tx)
        if (++commits <= refusals) {
          throw error()
        }
        return result
      }),
  }
  return { db: new Kysely<DB>({ dialect: new ActorSqliteDialect(sql) }), base, commits: () => commits }
}

describe('a refused commit', () => {
  test('is run again, and lands once', async () => {
    const { db, base, commits } = await refusing(1)
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('notes').values({ id: 'a' }).execute()
      await trx.insertInto('notes').values({ id: 'b' }).execute()
    })
    expect(await base.execute('select id from notes order by id')).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(commits()).toBe(2)
  })

  test('a rollback isn’t, and neither is any other failure', async () => {
    const rolled = await refusing(1)
    await expect(
      rolled.db.transaction().execute(async (trx) => {
        await trx.insertInto('notes').values({ id: 'a' }).execute()
        throw new Error('changed my mind')
      }),
    ).rejects.toThrow('changed my mind')
    expect(await rolled.base.execute('select id from notes')).toEqual([])

    const other = await refusing(1, () => new Error('disk I/O error'))
    await expect(
      other.db.transaction().execute(async (trx) => {
        await trx.insertInto('notes').values({ id: 'a' }).execute()
      }),
    ).rejects.toThrow('disk I/O error')
    expect(other.commits()).toBe(1)
  })
})
