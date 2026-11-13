// Kysely queries built once and run many times. Kysely builds a query by
// assembling and freezing a tree of nodes and then compiling it to SQL: about a
// fifth of the server's main thread at the design load (packages/load). The SQL
// for a given shape never changes, so a prepared query is built the first time,
// with a marker in place of each value, and then run with each call's values
// put where the markers were. Only the SQL is kept, never results.
import type { Compilable, CompiledQuery, Kysely } from 'kysely'

const MARK = '\u0000slot:'

/**
 * A query's values as `build` sees them: a marker for each one given (the
 * builder can't see the values themselves, so none can end up in the kept
 * SQL), undefined for each optional one left out (which picks the query's
 * shape). Each must be used as one value: a list (`in`) varies the SQL with
 * its length, so it can't be a slot (its marker is one value: the SQL reads
 * `in ?`, which the database refuses the first time it runs). A value of
 * `true` is a flag instead: it only picks the shape (the builder tests it), and
 * isn't sent to the database.
 */
export type Slots<P> = { readonly [K in keyof P]-?: undefined extends P[K] ? P[K] | undefined : P[K] }

/**
 * A query built once per shape and run with each call's values, on the
 * database or a transaction given: `prepared<Values>()((db, slot) => query)`,
 * the values' types given, the rows' inferred from the query.
 */
export function prepared<P extends Record<string, unknown>>() {
  return <DB, R>(build: (db: Kysely<DB>, slot: Slots<P>) => Compilable<R>) => preparedQuery<DB, P, R>(build)
}

function preparedQuery<DB, P extends Record<string, unknown>, R>(
  build: (db: Kysely<DB>, slot: Slots<P>) => Compilable<R>,
): (db: Kysely<DB>, values: P) => Promise<R[]> {
  const shapes = new Map<string, { compiled: CompiledQuery<R>; slots: Array<string | null> }>()
  return async (db, values) => {
    const given = Object.keys(values)
      .filter((k) => values[k] !== undefined)
      .sort()
    const shape = given.join(',')
    let held = shapes.get(shape)
    if (!held) {
      const markers = Object.fromEntries(given.map((k) => [k, `${MARK}${k}`])) as unknown as Slots<P>
      const compiled = build(db, markers).compile()
      const slots = compiled.parameters.map((p) =>
        typeof p === 'string' && p.startsWith(MARK) ? p.slice(MARK.length) : null,
      )
      for (const k of given) {
        if (values[k] !== true && !slots.includes(k)) {
          throw new Error(`prepared query: ${k} wasn't used as a single value (a list or literal can't be a slot)`)
        }
      }
      held = { compiled, slots }
      shapes.set(shape, held)
    }
    const { compiled, slots } = held
    const parameters = compiled.parameters.map((p, i) => (slots[i] === null ? p : values[slots[i]!]))
    return (await db.executeQuery<R>({ ...compiled, parameters })).rows
  }
}
