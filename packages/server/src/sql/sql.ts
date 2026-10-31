// The SQL an idea's storage needs: RivetKit's actor database (c.db) has this
// shape, and so does the bun:sqlite adapter the tests use.
export interface Sql {
  execute<T extends Record<string, unknown> = Record<string, unknown>>(query: string, ...args: unknown[]): Promise<T[]>
  transaction<T>(callback: (tx: Sql) => Promise<T>): Promise<T>
}
