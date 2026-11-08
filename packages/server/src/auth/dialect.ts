// A Kysely dialect over the actor database, for Better Auth. Better Auth runs
// inside the directory actor, on its own Kysely SQLite adapter and migration
// tooling, and needs two things the directory's own dialect (sql/kysely.ts)
// doesn't give:
//
// - Row counts for UPDATE and DELETE. The actor database returns rows only, so
//   a write without RETURNING gets `RETURNING 1` appended and its rows counted.
// - Kysely's begin / queries / commit transactions. The actor database only
//   offers transaction(callback), so a transaction opens one with a callback
//   that waits until Kysely commits or rolls back. One connection, behind a
//   lock, so statements outside a transaction wait for it to finish.
// - A retry when the engine refuses the commit because the actor's storage is
//   busy (sql/retry.ts): the transaction never reached storage, so its
//   statements, kept as they ran, are run again in a new one.
//
// Ported from the Better Auth spike (experiments/spike-better-auth/src/rivet-dialect.ts).
import {
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from 'kysely'
import { overloadedRetryMs } from '../sql/retry.ts'
import type { Sql } from '../sql/sql.ts'

class Rollback extends Error {}

/** How long a refused commit is retried for, in all. */
const COMMIT_RETRY_MS = 10_000

class ActorConnection implements DatabaseConnection {
  #tx: Sql | null = null
  #finish: ((commit: boolean) => void) | null = null
  #done: Promise<unknown> | null = null
  /** The open transaction's statements, to run again should its commit be refused. */
  #ran: Array<{ sql: string; parameters: unknown[] }> = []

  constructor(private readonly sql: Sql) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const target = this.#tx ?? this.sql
    const head = compiled.sql.trimStart().slice(0, 7).toLowerCase()
    const write = head.startsWith('update') || head.startsWith('delete') || head.startsWith('insert')
    const counting = write && !/\breturning\b/i.test(compiled.sql)
    const query = counting ? `${compiled.sql} returning 1 as __n` : compiled.sql
    const parameters = compiled.parameters as unknown[]
    if (this.#tx) {
      this.#ran.push({ sql: query, parameters })
    }
    const rows = await target.execute(query, ...parameters)
    if (counting) {
      return { rows: [], numAffectedRows: BigInt(rows.length) }
    }
    return write ? { rows: rows as R[], numAffectedRows: BigInt(rows.length) } : { rows: rows as R[] }
  }

  async begin(): Promise<void> {
    this.#ran = []
    let opened!: () => void
    const ready = new Promise<void>((resolve) => {
      opened = resolve
    })
    this.#done = this.sql
      .transaction(async (tx) => {
        this.#tx = tx
        opened()
        const commit = await new Promise<boolean>((resolve) => {
          this.#finish = resolve
        })
        if (!commit) {
          throw new Rollback()
        }
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) {
          throw error
        }
      })
    await ready
  }

  async end(commit: boolean): Promise<void> {
    this.#finish?.(commit)
    const done = this.#done
    const ran = this.#ran
    this.#tx = null
    this.#finish = null
    this.#done = null
    this.#ran = []
    try {
      await done
    } catch (error) {
      if (!commit) {
        throw error
      }
      await this.#replay(ran, error)
    }
  }

  /** Runs a refused transaction's statements again in a new one, waiting as the engine asks, while storage stays busy. */
  async #replay(ran: Array<{ sql: string; parameters: unknown[] }>, refused: unknown): Promise<void> {
    let error = refused
    let waited = 0
    for (;;) {
      const asked = overloadedRetryMs(error)
      if (asked === null || waited >= COMMIT_RETRY_MS) {
        throw error
      }
      const wait = Math.min(Math.max(asked, 50), 2_000, COMMIT_RETRY_MS - waited)
      await Bun.sleep(wait)
      waited += wait
      try {
        await this.sql.transaction(async (tx) => {
          for (const q of ran) {
            await tx.execute(q.sql, ...q.parameters)
          }
        })
        return
      } catch (next) {
        error = next
      }
    }
  }

  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('streaming queries are not supported')
  }
}

/** One connection at a time: a transaction holds it from begin to commit. */
class Lock {
  #held: Promise<void> | null = null
  #release: (() => void) | null = null

  async acquire(): Promise<void> {
    while (this.#held) {
      await this.#held
    }
    this.#held = new Promise((resolve) => {
      this.#release = resolve
    })
  }

  release(): void {
    const release = this.#release
    this.#held = null
    this.#release = null
    release?.()
  }
}

class ActorDriver implements Driver {
  readonly #lock = new Lock()
  readonly #connection: ActorConnection

  constructor(sql: Sql) {
    this.#connection = new ActorConnection(sql)
  }
  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    await this.#lock.acquire()
    return this.#connection
  }
  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await (connection as ActorConnection).begin()
  }
  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await (connection as ActorConnection).end(true)
  }
  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await (connection as ActorConnection).end(false)
  }
  async releaseConnection(): Promise<void> {
    this.#lock.release()
  }
  async destroy(): Promise<void> {}
}

export class ActorSqliteDialect implements Dialect {
  constructor(private readonly sql: Sql) {}
  createDriver(): Driver {
    return new ActorDriver(this.sql)
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
