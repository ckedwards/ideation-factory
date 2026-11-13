// Mints every seeded person a 15-minute access token from their session, as
// the web app does, a few at a time, just before k6 runs: into
// .data/tokens.json, which k6 reads. At steady state people's tokens were got
// at different times over the last 15 minutes; fetching all 10,000 as the test
// starts would be a sign-in storm instead (a test of its own).
//
//   bun packages/load/src/tokens.ts         (run.sh does this before each run)
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Person, Seed } from './seed.ts'

const env = process.env
const APP = env.LOAD_APP_URL ?? 'http://localhost:18080'
const ORIGIN = env.LOAD_ORIGIN ?? 'https://localhost:18443'
const DATA = join(import.meta.dir, '../.data')
const CONCURRENCY = Number(env.LOAD_CONCURRENCY ?? 16)

const seed = JSON.parse(readFileSync(env.LOAD_SEED ?? join(DATA, 'seed.json'), 'utf8')) as Seed
const tokens: string[] = Array.from({ length: seed.people.length }, () => '')
const started = Date.now()
let next = 0
let failed = 0

async function mint(person: Person): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`${APP}/api/auth/token`, {
      headers: { cookie: person.cookie, origin: ORIGIN, 'x-forwarded-for': person.ip },
    })
    if (response.ok) {
      return ((await response.json()) as { token: string }).token
    }
    await Bun.sleep(250 * 2 ** attempt)
  }
  throw new Error(`no token for ${person.handle}`)
}

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < seed.people.length) {
      const i = next++
      try {
        tokens[i] = await mint(seed.people[i]!)
      } catch {
        failed++
      }
    }
  }),
)
writeFileSync(join(DATA, 'tokens.json'), JSON.stringify({ minted: started, tokens }))
console.log(
  `minted ${tokens.length - failed} tokens in ${((Date.now() - started) / 1000).toFixed(0)} s` +
    (failed > 0 ? `, ${failed} failed (those people fetch theirs in the test)` : ''),
)
