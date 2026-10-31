// bun:sqlite behind the Sql interface, for tests and tools.
import { Database } from 'bun:sqlite'
import type { Sql } from './sql.ts'

export function bunSql(db = new Database(':memory:')): Sql {
  const execute: Sql['execute'] = async <T extends Record<string, unknown>>(query: string, ...args: unknown[]) =>
    db.query(query).all(...(args as never[])) as T[]
  // one transaction at a time, like RivetKit's actor database: a second waits for the first
  let queue: Promise<unknown> = Promise.resolve()
  const sql: Sql = {
    execute,
    transaction(callback) {
      const run = queue.then(async () => {
        db.run('BEGIN')
        try {
          const result = await callback({ execute, transaction: () => Promise.reject(new Error('nested transaction')) })
          db.run('COMMIT')
          return result
        } catch (error) {
          db.run('ROLLBACK')
          throw error
        }
      })
      queue = run.catch(() => {})
      return run
    },
  }
  return sql
}
