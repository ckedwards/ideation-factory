// Where the actors run. Each actor is made in a pool of the engine's nodes and
// stays in it: an actor's pool is fixed when it's made.
//
// Ideas and search run in the app's pool, on the nodes that serve the API. The
// directory runs in IDEAF_DIRECTORY_POOL, on nodes of its own (started with
// RIVET_POOL set to the same name), so its work has a process to itself
// (docs/admin/performance.md). Unset, as in development and the tests, it's the
// app's pool too. Because the pool is fixed, a deployment sets it from the
// start: moving the directory to a pool of its own later means moving its data.
//
// A client asks for its own node's pool unless told otherwise, so on a
// directory node the calls would make ideas in the directory's pool: every call
// here names its pool.

/** The pool the app's nodes join (RIVET_POOL unset). */
export const APP_POOL = 'default'

/** The directory's pool: its own nodes', or the app's. */
export const directoryPool = (): string => process.env.IDEAF_DIRECTORY_POOL || APP_POOL

export const DIRECTORY_KEY = ['main']
export const SEARCH_KEY = ['main']

type Accessor<H> = { getOrCreate(key: string[], options?: { poolName?: string }): H }

/** The directory, in its pool. */
export const directoryOf = <H>(actors: { directory: Accessor<H> }): H =>
  actors.directory.getOrCreate(DIRECTORY_KEY, { poolName: directoryPool() })

/** The search index, in the app's pool. */
export const searchOf = <H>(actors: { search: Accessor<H> }): H =>
  actors.search.getOrCreate(SEARCH_KEY, { poolName: APP_POOL })

/** An idea, in the app's pool. */
export const ideaOf = <H>(actors: { idea: Accessor<H> }, id: string): H =>
  actors.idea.getOrCreate([id], { poolName: APP_POOL })
