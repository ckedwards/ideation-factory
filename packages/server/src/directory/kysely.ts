// Kysely on top of the Sql interface (RivetKit's actor database, or bun:sqlite
// in tests), so the directory's queries are typed and written once for SQLite
// and Postgres. Transactions go through Sql.transaction (RivetKit's own), with a
// Kysely bound to the transaction, never Kysely's BEGIN/COMMIT.
import {
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  Kysely,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from 'kysely'
import type { Sql } from '../idea/sql.ts'

class SqlConnection implements DatabaseConnection {
  constructor(private readonly sql: Sql) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const rows = await this.sql.execute(query.sql, ...query.parameters)
    return { rows: rows as R[] }
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('streaming queries are not supported')
  }
}

class SqlDriver implements Driver {
  readonly #connection: SqlConnection
  constructor(sql: Sql) {
    this.#connection = new SqlConnection(sql)
  }
  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    return this.#connection
  }
  async beginTransaction(): Promise<void> {
    throw new Error('use Sql.transaction, not Kysely transactions')
  }
  async commitTransaction(): Promise<void> {}
  async rollbackTransaction(): Promise<void> {}
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
}

export function sqliteKysely<DB>(sql: Sql): Kysely<DB> {
  const dialect: Dialect = {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new SqlDriver(sql),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  }
  return new Kysely<DB>({ dialect })
}
