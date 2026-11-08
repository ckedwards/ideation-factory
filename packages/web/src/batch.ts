// Asking for things one at a time, fetched together: everything asked for in
// the same moment (before the next turn of the event loop) goes in one
// request, up to `max` at a time. Each caller still gets just its own thing,
// so each can be cached on its own (a person, by ID).

export function batched<T>(
  fetchMany: (ids: string[]) => Promise<T[]>,
  idOf: (item: T) => string,
  { max = 100, missing = (id: string) => new Error(`no ${id}`) } = {},
): (id: string) => Promise<T> {
  let waiting: Map<string, { resolve: (item: T) => void; reject: (error: unknown) => void }[]> | null = null

  const flush = async (batch: NonNullable<typeof waiting>) => {
    const ids = [...batch.keys()]
    for (let i = 0; i < ids.length; i += max) {
      const chunk = ids.slice(i, i + max)
      try {
        const found = new Map((await fetchMany(chunk)).map((item) => [idOf(item), item]))
        for (const id of chunk) {
          const item = found.get(id)
          for (const caller of batch.get(id)!) {
            if (item) {
              caller.resolve(item)
            } else {
              caller.reject(missing(id))
            }
          }
        }
      } catch (error) {
        for (const id of chunk) {
          batch.get(id)!.forEach((caller) => caller.reject(error))
        }
      }
    }
  }

  return (id) =>
    new Promise<T>((resolve, reject) => {
      if (!waiting) {
        const batch = new Map<string, { resolve: (item: T) => void; reject: (error: unknown) => void }[]>()
        waiting = batch
        setTimeout(() => {
          waiting = null
          void flush(batch)
        })
      }
      waiting.set(id, [...(waiting.get(id) ?? []), { resolve, reject }])
    })
}
