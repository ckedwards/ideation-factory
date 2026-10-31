// Approach 1, app side: a Better Auth custom adapter whose every operation is
// one action on the directory actor (see sql-store.ts for the SQL). Better
// Auth runs on the app node; only storage crosses to the actor.
import { createAdapterFactory } from 'better-auth/adapters'
import type { StoreOp } from './sql-store.ts'

export type StoreCall = (op: StoreOp) => Promise<unknown>

/** Directory calls made through this adapter, for the measures. */
export const calls = { count: 0, log: [] as string[] }

export function directoryAdapter(call: StoreCall) {
  const send = async (op: StoreOp) => {
    calls.count++
    calls.log.push(`${op.op} ${op.model}`)
    return call(op)
  }
  return createAdapterFactory({
    config: {
      adapterId: 'directory-actor',
      adapterName: 'Directory actor',
      // Same conversions Better Auth's SQLite (Kysely) adapter uses, so the
      // schema its migration tooling generates for SQLite fits.
      supportsJSON: false,
      supportsDates: false,
      supportsBooleans: false,
      supportsArrays: false,
      supportsNumericIds: true,
      // Every operation is its own actor action; no transaction spans two.
      transaction: false,
    },
    adapter: () => ({
      create: ({ model, data, select }) => send({ op: 'create', model, data, ...(select ? { select } : {}) }) as never,
      findOne: ({ model, where, select }) => send({ op: 'findOne', model, where: where as never, ...(select ? { select } : {}) }) as never,
      findMany: ({ model, where, limit, offset, select, sortBy }) =>
        send({
          op: 'findMany',
          model,
          where: where as never,
          limit,
          ...(offset !== undefined ? { offset } : {}),
          ...(select ? { select } : {}),
          ...(sortBy ? { sortBy } : {}),
        }) as never,
      count: ({ model, where }) => send({ op: 'count', model, where: where as never }) as never,
      update: ({ model, where, update }) => send({ op: 'update', model, where: where as never, update: update as never }) as never,
      updateMany: ({ model, where, update }) => send({ op: 'updateMany', model, where: where as never, update }) as never,
      delete: async ({ model, where }) => void (await send({ op: 'delete', model, where: where as never })),
      deleteMany: ({ model, where }) => send({ op: 'deleteMany', model, where: where as never }) as never,
      consumeOne: ({ model, where }) => send({ op: 'consumeOne', model, where: where as never }) as never,
      incrementOne: ({ model, where, increment, set }) =>
        send({ op: 'incrementOne', model, where: where as never, increment, ...(set ? { set } : {}) }) as never,
    }),
  })
}
