// Approach 1, actor side: Better Auth's adapter operations (create, findOne,
// findMany, update, updateMany, delete, deleteMany, count, consumeOne,
// incrementOne) as SQL against the directory actor's SQLite. The app-side
// adapter (remote-adapter.ts) sends each operation here as one actor action.
//
// Values arrive already converted by Better Auth's adapter factory
// (supportsDates/Booleans/JSON/Arrays all false), so they're strings, numbers
// or null. Each statement is atomic in SQLite, and the actor runs one action's
// statements without interleaving any other's await points, so consumeOne and
// incrementOne use a single `... RETURNING *` each.

export interface RawSql {
  execute<T extends Record<string, unknown> = Record<string, unknown>>(query: string, ...args: unknown[]): Promise<T[]>
}

export type Where = {
  field: string
  operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'not_in' | 'contains' | 'starts_with' | 'ends_with'
  value: unknown
  connector: 'AND' | 'OR'
  mode?: 'sensitive' | 'insensitive'
}

export type StoreOp =
  | { op: 'create'; model: string; data: Record<string, unknown>; select?: string[] }
  | { op: 'findOne'; model: string; where: Where[]; select?: string[] }
  | { op: 'findMany'; model: string; where?: Where[]; limit: number; offset?: number; select?: string[]; sortBy?: { field: string; direction: 'asc' | 'desc' } }
  | { op: 'count'; model: string; where?: Where[] }
  | { op: 'update'; model: string; where: Where[]; update: Record<string, unknown> }
  | { op: 'updateMany'; model: string; where: Where[]; update: Record<string, unknown> }
  | { op: 'delete'; model: string; where: Where[] }
  | { op: 'deleteMany'; model: string; where: Where[] }
  | { op: 'consumeOne'; model: string; where: Where[] }
  | { op: 'incrementOne'; model: string; where: Where[]; increment: Record<string, number>; set?: Record<string, unknown> }

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
function q(name: string): string {
  if (!IDENT.test(name)) throw new Error(`bad identifier ${name}`)
  return `"${name}"`
}

function whereSql(where: Where[] | undefined): { sql: string; args: unknown[] } {
  if (!where || where.length === 0) return { sql: '', args: [] }
  const args: unknown[] = []
  // Better Auth's own adapters group AND clauses and OR clauses: (a AND b) AND (c OR d)
  const and: string[] = []
  const or: string[] = []
  for (const w of where) {
    const ci = w.mode === 'insensitive' && typeof w.value === 'string'
    const col = ci ? `lower(${q(w.field)})` : q(w.field)
    const v = ci ? (w.value as string).toLowerCase() : w.value
    let clause: string
    switch (w.operator) {
      case 'eq':
        if (v === null) clause = `${col} IS NULL`
        else ((clause = `${col} = ?`), args.push(v))
        break
      case 'ne':
        if (v === null) clause = `${col} IS NOT NULL`
        else ((clause = `${col} IS NOT ?`), args.push(v))
        break
      case 'lt': case 'lte': case 'gt': case 'gte': {
        const ops = { lt: '<', lte: '<=', gt: '>', gte: '>=' } as const
        clause = `${col} ${ops[w.operator]} ?`
        args.push(v)
        break
      }
      case 'in': case 'not_in': {
        const list = (Array.isArray(v) ? v : [v]) as unknown[]
        if (list.length === 0) clause = w.operator === 'in' ? '0' : '1'
        else {
          clause = `${col} ${w.operator === 'in' ? 'IN' : 'NOT IN'} (${list.map(() => '?').join(', ')})`
          args.push(...list)
        }
        break
      }
      case 'contains': clause = `${col} LIKE ? ESCAPE '\\'`; args.push(`%${escapeLike(String(v))}%`); break
      case 'starts_with': clause = `${col} LIKE ? ESCAPE '\\'`; args.push(`${escapeLike(String(v))}%`); break
      case 'ends_with': clause = `${col} LIKE ? ESCAPE '\\'`; args.push(`%${escapeLike(String(v))}`); break
      default: throw new Error(`unsupported operator ${String((w as Where).operator)}`)
    }
    ;(w.connector === 'OR' ? or : and).push(clause)
  }
  const parts = [...and]
  if (or.length) parts.push(`(${or.join(' OR ')})`)
  return { sql: ` WHERE ${parts.join(' AND ')}`, args }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function cols(select?: string[]): string {
  return select && select.length ? select.map(q).join(', ') : '*'
}

/** Statements run per operation, for the "directory calls per sign-in" measure. */
export const stats = { ops: 0, statements: 0, byOp: {} as Record<string, number> }

export async function runStoreOp(db: RawSql, o: StoreOp): Promise<unknown> {
  stats.ops++
  stats.byOp[`${o.op} ${o.model}`] = (stats.byOp[`${o.op} ${o.model}`] ?? 0) + 1
  const exec = <T extends Record<string, unknown>>(sql: string, args: unknown[]) => {
    stats.statements++
    return db.execute<T>(sql, ...args)
  }
  const table = q(o.model)
  switch (o.op) {
    case 'create': {
      const keys = Object.keys(o.data)
      const rows = await exec(
        `INSERT INTO ${table} (${keys.map(q).join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) RETURNING ${cols(o.select)}`,
        keys.map((k) => o.data[k]),
      )
      return rows[0]
    }
    case 'findOne': {
      const w = whereSql(o.where)
      const rows = await exec(`SELECT ${cols(o.select)} FROM ${table}${w.sql} LIMIT 1`, w.args)
      return rows[0] ?? null
    }
    case 'findMany': {
      const w = whereSql(o.where)
      const order = o.sortBy ? ` ORDER BY ${q(o.sortBy.field)} ${o.sortBy.direction === 'desc' ? 'DESC' : 'ASC'}` : ''
      return exec(`SELECT ${cols(o.select)} FROM ${table}${w.sql}${order} LIMIT ? OFFSET ?`, [...w.args, o.limit, o.offset ?? 0])
    }
    case 'count': {
      const w = whereSql(o.where)
      const rows = await exec<{ n: number }>(`SELECT count(*) AS n FROM ${table}${w.sql}`, w.args)
      return Number(rows[0]?.n ?? 0)
    }
    case 'update': {
      if (!o.where.length) return null
      const keys = Object.keys(o.update)
      const w = whereSql(o.where)
      // update one row: Better Auth's update is "a single row matching"
      const rows = await exec(
        `UPDATE ${table} SET ${keys.map((k) => `${q(k)} = ?`).join(', ')} WHERE rowid = (SELECT rowid FROM ${table}${w.sql} LIMIT 1) RETURNING *`,
        [...keys.map((k) => o.update[k]), ...w.args],
      )
      return rows[0] ?? null
    }
    case 'updateMany': {
      const keys = Object.keys(o.update)
      const w = whereSql(o.where)
      const rows = await exec(`UPDATE ${table} SET ${keys.map((k) => `${q(k)} = ?`).join(', ')}${w.sql} RETURNING 1 AS x`, [
        ...keys.map((k) => o.update[k]),
        ...w.args,
      ])
      return rows.length
    }
    case 'delete': {
      const w = whereSql(o.where)
      await exec(`DELETE FROM ${table}${w.sql}`, w.args)
      return null
    }
    case 'deleteMany': {
      const w = whereSql(o.where)
      const rows = await exec(`DELETE FROM ${table}${w.sql} RETURNING 1 AS x`, w.args)
      return rows.length
    }
    case 'consumeOne': {
      const w = whereSql(o.where)
      const rows = await exec(`DELETE FROM ${table} WHERE rowid = (SELECT rowid FROM ${table}${w.sql} LIMIT 1) RETURNING *`, w.args)
      return rows[0] ?? null
    }
    case 'incrementOne': {
      const w = whereSql(o.where)
      const sets: string[] = []
      const args: unknown[] = []
      for (const [k, d] of Object.entries(o.increment)) ((sets.push(`${q(k)} = ${q(k)} + ?`)), args.push(d))
      for (const [k, v] of Object.entries(o.set ?? {})) ((sets.push(`${q(k)} = ?`)), args.push(v))
      const rows = await exec(
        `UPDATE ${table} SET ${sets.join(', ')} WHERE rowid = (SELECT rowid FROM ${table}${w.sql} LIMIT 1) RETURNING *`,
        [...args, ...w.args],
      )
      return rows[0] ?? null
    }
  }
}
