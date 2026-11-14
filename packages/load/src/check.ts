// Opens every seeded idea once, the way its page does, and lists the ones that don't open: a
// check that the seed is whole before measuring on it, and after anything that restarts engines
// under load (on the Frankfurt deployment, engine restarts left ideas whose databases never
// opened again). Each idea is opened by one of ten members of its team, with their personal
// token, so no one person's rate limit decides the pace.
//
//   bun packages/load/src/check.ts          (remote.sh check)
//
// The ideas that failed go to .data/check-failed.txt, one per line with its status and error.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ideaTeam } from './model.ts'
import type { Seed } from './seed.ts'

const env = process.env
const APP = env.LOAD_APP_URL ?? 'http://localhost:18080'
const ORIGIN = env.LOAD_ORIGIN ?? 'https://localhost:18443'
const DATA = join(import.meta.dir, '../.data')
const CONCURRENCY = Number(env.LOAD_CONCURRENCY ?? 32)

const seed = JSON.parse(readFileSync(env.LOAD_SEED ?? join(DATA, 'seed.json'), 'utf8')) as Seed
const people = seed.people.length
const teams = seed.teams.length
const total = seed.ideas.length
const failures: string[] = []
const started = Date.now()
let next = 0
let opened = 0

/** A member of idea j's team: person t + teams × n is always in team t; n spreads them over ten. */
function opener(j: number) {
  const t = ideaTeam(j, teams)
  const n = Math.floor(j / teams) % 10
  return seed.people[(t + teams * n) % people]!
}

/** The idea's page as its opener sees it: null if it opened, otherwise why not. */
async function open(j: number): Promise<string | null> {
  const person = opener(j)
  const id = seed.ideas[j]!
  let last = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(`${APP}/api/ideas/${id}/page`, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${person.token}`,
          origin: ORIGIN,
          'x-forwarded-for': person.ip,
        },
      })
      if (response.ok) {
        await response.arrayBuffer()
        return null
      }
      last = `${response.status} ${(await response.text()).slice(0, 200).replaceAll('\n', ' ')}`
      // refused for now (a rate limit, a busy server): wait and ask again; anything else is the answer
      if (response.status !== 429 && response.status !== 503) {
        return last
      }
    } catch (error) {
      last = `no answer: ${String(error)}`
    }
    await Bun.sleep(500 * 2 ** attempt)
  }
  return last
}

const report = setInterval(() => {
  const seconds = (Date.now() - started) / 1000
  console.log(`opened ${opened}/${total}, ${(opened / seconds).toFixed(1)}/s, ${failures.length} failed`)
}, 10_000)

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < total) {
      const j = next++
      const failed = await open(j)
      opened++
      if (failed) {
        failures.push(`${seed.ideas[j]}\t${failed}`)
        console.log(`idea ${j} (${seed.ideas[j]}): ${failed}`)
      }
    }
  }),
)
clearInterval(report)
writeFileSync(join(DATA, 'check-failed.txt'), failures.join('\n') + (failures.length > 0 ? '\n' : ''))
const seconds = ((Date.now() - started) / 1000).toFixed(0)
console.log(`checked ${total} ideas in ${seconds} s: ${total - failures.length} opened, ${failures.length} failed`)
if (failures.length > 0) {
  console.log(`the failed ones: ${join(DATA, 'check-failed.txt')}`)
  process.exit(1)
}
