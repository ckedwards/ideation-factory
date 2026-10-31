// Approach 2: a Kysely dialect over a RivetKit actor's database (c.db), so
// Better Auth's own SQLite (Kysely) adapter and migration tooling run inside
// the directory actor. Modeled on Better Auth's bun:sqlite dialect.
//
// Two gaps between c.db and what Kysely expects:
// - c.db.execute returns rows only, no "changes" count. Better Auth needs
//   numUpdatedRows/numDeletedRows, so UPDATE/DELETE without RETURNING get
//   `RETURNING 1` appended and the rows are counted.
// - Kysely drives transactions as begin / queries / commit on a connection;
//   c.db only offers transaction(callback). beginTransaction opens
//   c.db.transaction with a callback that waits until commit or rollback.
import {
  CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from 'kysely'

export interface RawAccess {
  execute<T extends Record<string, unknown> = Record<string, unknown>>(query: string, ...args: unknown[]): Promise<T[]>
  transaction<T>(callback: (tx: RawAccess) => Promise<T> | T): Promise<T>
}

export const dialectStats = { statements: 0 }

class RivetConnection implements DatabaseConnection {
  tx: RawAccess | null = null
  private finish: ((commit: boolean) => void) | null = null
  private done: Promise<unknown> | null = null
  constructor(private db: RawAccess) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    dialectStats.statements++
    const target = this.tx ?? this.db
    let sql = compiled.sql
    const head = sql.trimStart().slice(0, 7).toLowerCase()
    const isWrite = head.startsWith('update') || head.startsWith('delete') || head.startsWith('insert')
    const counting = isWrite && !/\breturning\b/i.test(sql)
    if (counting) sql += ' returning 1 as __n'
    const rows = await target.execute(sql, ...(compiled.parameters as unknown[]))
    if (counting) return { rows: [], numAffectedRows: BigInt(rows.length) }
    if (isWrite) return { rows: rows as R[], numAffectedRows: BigInt(rows.length) }
    return { rows: rows as R[] }
  }

  async begin(): Promise<void> {
    let ready!: () => void
    const opened = new Promise<void>((r) => (ready = r))
    this.done = this.db
      .transaction(async (tx) => {
        this.tx = tx
        ready()
        const commit = await new Promise<boolean>((r) => (this.finish = r))
        if (!commit) throw new RollbackSignal()
      })
      .catch((e) => {
        if (!(e instanceof RollbackSignal)) throw e
      })
    await opened
  }

  async end(commit: boolean): Promise<void> {
    this.finish?.(commit)
    const done = this.done
    this.tx = null
    this.finish = null
    this.done = null
    await done
  }

  // biome-ignore lint: required by the interface
  async *streamQuery(): AsyncIterableIterator<QueryResult<never>> {
    throw new Error('streaming is not supported')
  }
}

class RollbackSignal extends Error {}

class Mutex {
  private p: Promise<void> | undefined
  private r: (() => void) | undefined
  async lock() {
    while (this.p) await this.p
    this.p = new Promise((r) => (this.r = r))
  }
  unlock() {
    const r = this.r
    this.p = undefined
    this.r = undefined
    r?.()
  }
}

class RivetDriver implements Driver {
  private mutex = new Mutex()
  private conn: RivetConnection
  constructor(db: RawAccess) {
    this.conn = new RivetConnection(db)
  }
  async init() {}
  async acquireConnection() {
    await this.mutex.lock()
    return this.conn
  }
  async beginTransaction(c: DatabaseConnection) {
    await (c as RivetConnection).begin()
  }
  async commitTransaction(c: DatabaseConnection) {
    await (c as RivetConnection).end(true)
  }
  async rollbackTransaction(c: DatabaseConnection) {
    await (c as RivetConnection).end(false)
  }
  async releaseConnection() {
    this.mutex.unlock()
  }
  async destroy() {}
}

export class RivetSqliteDialect implements Dialect {
  constructor(private db: RawAccess) {}
  createDriver() {
    return new RivetDriver(this.db)
  }
  createQueryCompiler() {
    return new SqliteQueryCompiler()
  }
  createAdapter() {
    return new SqliteAdapter()
  }
  createIntrospector(db: Kysely<unknown>) {
    return new SqliteIntrospector(db)
  }
}

// keep CompiledQuery referenced for consumers building raw statements
export { CompiledQuery }
