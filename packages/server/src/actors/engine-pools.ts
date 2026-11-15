// The engine's node pools, made by the app itself before it joins one: RivetKit makes a pool only
// for an engine it starts itself (development), and the engine refuses a node whose pool doesn't
// exist. Every process makes sure of both (the app's and the directory's): it's harmless to repeat.
// Old app versions are drained once a newer one connects (drain_on_version_upgrade).
//
// It waits for an engine that's still starting (a new one takes about a minute), and stops at once
// on a token the engine refuses.

/** Makes sure each pool exists on the engine RIVET_ENDPOINT names, with its admin token in it. */
export async function ensurePools(
  endpoint: string,
  pools: readonly string[],
  { timeoutMs = 180_000, retryMs = 2_000 } = {},
): Promise<void> {
  const url = new URL(endpoint)
  const namespace = decodeURIComponent(url.username) || 'default'
  const token = decodeURIComponent(url.password)
  if (!token) {
    throw new Error("the engine's endpoint has no admin token in it (engine.token) to make its node pools with")
  }
  const base = `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`
  const deadline = Date.now() + timeoutMs
  for (const pool of new Set(pools)) {
    for (;;) {
      let problem: string
      try {
        const response = await fetch(
          `${base}/pools/${encodeURIComponent(pool)}?namespace=${encodeURIComponent(namespace)}`,
          {
            method: 'PUT',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ drain_on_version_upgrade: true }),
            signal: AbortSignal.timeout(5_000),
          },
        )
        if (response.ok) {
          break
        }
        if (response.status === 401 || response.status === 403) {
          throw new PoolError(
            `the engine refused the admin token (engine.token) making the ${pool} pool: ${response.status}`,
          )
        }
        problem = `${response.status} ${(await response.text()).slice(0, 200)}`
      } catch (error) {
        if (error instanceof PoolError) {
          throw error
        }
        problem = (error as Error).message
      }
      if (Date.now() > deadline) {
        throw new Error(`couldn't make the engine's ${pool} pool at ${base} in ${timeoutMs / 1000} s: ${problem}`)
      }
      await Bun.sleep(retryMs)
    }
  }
}

class PoolError extends Error {}
