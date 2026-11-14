// A timeline of what answers, for fail-over runs: twice a second, one seeded person's own details
// (GET /me, which needs the directory) and a random idea's page (which needs that idea's actor),
// each logged with its time, status and duration. Run it beside a steady run, kill or stop
// something, and the log says when each kind of request failed and when it answered again.
//
//   bun packages/load/src/probe.ts          (remote.sh probe; stop it with Ctrl-C)
//
// Each request goes to .data/results/probe-<time>.tsv (the time in ms, what, status, ms taken);
// every 10 s it prints how many of each failed, and on Ctrl-C each stretch of failures.
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ideaTeam } from './model.ts'
import type { Seed } from './seed.ts'

const env = process.env
const APP = env.LOAD_APP_URL ?? 'http://localhost:18080'
const ORIGIN = env.LOAD_ORIGIN ?? 'https://localhost:18443'
const DATA = join(import.meta.dir, '../.data')
const EVERY_MS = Number(env.LOAD_PROBE_MS ?? 500)
const TIMEOUT_MS = Number(env.LOAD_PROBE_TIMEOUT_MS ?? 10_000)

const seed = JSON.parse(readFileSync(env.LOAD_SEED ?? join(DATA, 'seed.json'), 'utf8')) as Seed
const people = seed.people.length
const teams = seed.teams.length
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
const out = join(DATA, 'results', `probe-${stamp}.tsv`)
appendFileSync(out, 'ms\twhat\tstatus\ttook_ms\n')

type What = 'directory' | 'idea'
/** Stretches of failures by kind: [first failure, last failure] in ms. */
const stretches: Record<What, Array<[number, number]>> = { directory: [], idea: [] }
const counts: Record<What, { ok: number; failed: number }> = {
  directory: { ok: 0, failed: 0 },
  idea: { ok: 0, failed: 0 },
}

async function probe(what: What, path: string, person: Seed['people'][number]) {
  const sent = Date.now()
  let status = 0
  try {
    const response = await fetch(`${APP}/api${path}`, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${person.token}`,
        origin: ORIGIN,
        'x-forwarded-for': person.ip,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    await response.arrayBuffer()
    status = response.status
  } catch {
    status = 0
  }
  const took = Date.now() - sent
  appendFileSync(out, `${sent}\t${what}\t${status}\t${took}\n`)
  const ok = status >= 200 && status < 300
  counts[what][ok ? 'ok' : 'failed']++
  if (!ok) {
    const last = stretches[what].at(-1)
    // a failure within 5 s of the last one is the same stretch
    if (last && sent - last[1] < 5_000) {
      last[1] = sent
    } else {
      stretches[what].push([sent, sent])
    }
  }
}

const tick = setInterval(() => {
  const j = Math.floor(Math.random() * seed.ideas.length)
  const t = ideaTeam(j, teams)
  const member = seed.people[(t + teams * Math.floor(Math.random() * 10)) % people]!
  void probe('directory', '/me', member)
  void probe('idea', `/ideas/${seed.ideas[j]}/page`, member)
}, EVERY_MS)

const report = setInterval(() => {
  const line = (['directory', 'idea'] as const).map((w) => `${w} ${counts[w].ok} ok, ${counts[w].failed} failed`)
  console.log(`${new Date().toISOString().slice(11, 19)} ${line.join('; ')}`)
}, 10_000)

process.on('SIGINT', () => {
  clearInterval(tick)
  clearInterval(report)
  const time = (ms: number) => new Date(ms).toISOString().slice(11, 23)
  for (const what of ['directory', 'idea'] as const) {
    if (stretches[what].length === 0) {
      console.log(`${what}: no failures`)
    }
    for (const [first, last] of stretches[what]) {
      console.log(`${what}: failing from ${time(first)} to ${time(last)} UTC (${((last - first) / 1000).toFixed(1)} s)`)
    }
  }
  console.log(`every request: ${out}`)
  process.exit(0)
})
