// bun:sqlite behind the Sql interface, for tests and tools.
import { Database } from 'bun:sqlite'
import type { Sql } from './sql.ts'

export function bunSql(db = new Database(':memory:')): Sql {
  const execute: Sql['execute'] = async <T extends Record<string, unknown>>(query: string, ...args: unknown[]) =>
    db.query(query).all(...(args as never[])) as T[]
  const sql: Sql = {
    execute,
    async transaction(callback) {
      db.run('BEGIN')
      try {
        const result = await callback({ execute, transaction: () => Promise.reject(new Error('nested transaction')) })
        db.run('COMMIT')
        return result
      } catch (error) {
        db.run('ROLLBACK')
        throw error
      }
    },
  }
  return sql
}
