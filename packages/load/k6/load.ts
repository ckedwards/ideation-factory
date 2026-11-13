// The load test: the seeded people (seed.ts) using the app, through its API as
// the web app and agents do.
//
//   pages  the steady state: page views (lists, search, the inbox, idea pages,
//          now and then a comment) at LOAD_RATE a second, each by one of the
//          seeded people. 10,000 people viewing a page a minute is 167 a second.
//          Each makes the reads the web app's loaders make for that page.
//   badge  the inbox badge, which the web app's shell reads once a minute while
//          its tab is in front: LOAD_BADGE_RATE a second (LOAD_RATE unless set,
//          as each of the people viewing pages has the app open).
//   bots   the bot burst (LOAD_BOTS > 0): agents commenting and editing on
//          their 12 ideas each, as fast as they're answered, beside the pages.
//
// Each person signs in as the web app does (their session swapped for a
// 15-minute JWT, renewed as it runs out) or, with LOAD_AUTH=token, with a
// personal token, checked in the directory on every request. Each sends its
// own X-Forwarded-For, so rate limits count people apart. Every call's time is
// recorded under its operation's name (op_<name>).
import { check } from 'k6'
import { SharedArray } from 'k6/data'
import exec from 'k6/execution'
import http from 'k6/http'
import { Counter, Rate, Trend } from 'k6/metrics'
import { memberTeams, teamAdmin, WORDS } from '../src/model.ts'

interface Person {
  handle: string
  id: string
  ip: string
  cookie: string
  token: string
}

const env = __ENV
const BASE = env.LOAD_URL || 'http://app:8080'
/** Several app processes (LOAD_URLS, comma-separated): each VU sticks to one, as a load balancer's connections would. */
const BASES = env.LOAD_URLS ? env.LOAD_URLS.split(',') : [BASE]
const base = () => BASES[(exec.vu.idInTest - 1) % BASES.length]!
const ORIGIN = env.LOAD_ORIGIN || 'https://localhost:18443'
const SEED = env.LOAD_SEED || '/data/seed.json'
const AUTH = env.LOAD_AUTH === 'token' ? 'token' : 'jwt'
const RATE = Number(env.LOAD_RATE || 167)
const DURATION = env.LOAD_DURATION || '10m'
/** VUs kept for page views; each serves its own slice of the people, so tokens renew at the real rate. */
const VUS = Number(env.LOAD_VUS || 300)
const BOTS = Number(env.LOAD_BOTS || 0)
/** Token renewals a second: 10,000 people renewing 15-minute tokens is about 11. */
const REFRESH_RATE = Number(env.LOAD_REFRESH_RATE || 11)
const TOKENS = env.LOAD_TOKENS || '/data/tokens.json'
const BADGE_RATE = Number(env.LOAD_BADGE_RATE || RATE)
/** The share of page views that load the app afresh (a new tab, a reload), and so read who you are and your teams first. */
const FRESH = Number(env.LOAD_FRESH || 0.1)
const BOT_IDEAS = 12

const people = new SharedArray('people', () => (JSON.parse(open(SEED)) as { people: Person[] }).people)
const teams = new SharedArray('teams', () => (JSON.parse(open(SEED)) as { teams: string[] }).teams)
const ideas = new SharedArray('ideas', () => (JSON.parse(open(SEED)) as { ideas: string[] }).ideas)
/** Tokens minted just before the run (src/tokens.ts), by person; when they were minted is the first entry. */
const minted = new SharedArray('tokens', () => {
  if (AUTH !== 'jwt') {
    return ['0']
  }
  const file = JSON.parse(open(TOKENS)) as { minted: number; tokens: string[] }
  return [String(file.minted), ...file.tokens]
})

const OPS = [
  'auth_token',
  'whoami',
  'list_my_memberships',
  'list_team_members',
  'get_team_watch',
  'get_people',
  'list_ideas',
  'get_team',
  'search_ideas',
  'list_notifications',
  'count_unread_notifications',
  'mark_notifications',
  'get_idea',
  'open_idea',
  'pull',
  'list_comments',
  'list_reviews',
  'add_comment',
  'edit',
] as const
type Op = (typeof OPS)[number]
const times = Object.fromEntries(OPS.map((op) => [op, new Trend(`op_${op}`, true)])) as Record<Op, Trend>
const failed = new Rate('op_failed')
const refusals = new Counter('op_refused')
/** A write against a version someone has since moved on from (stale_version): expected when people race, not a failure. */
const stale = new Counter('op_stale')

export const options = {
  scenarios: {
    pages: {
      executor: 'constant-arrival-rate',
      exec: 'pageView',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: VUS,
      maxVUs: VUS * 4,
    },
    ...(BADGE_RATE > 0
      ? {
          badge: {
            executor: 'constant-arrival-rate',
            exec: 'badge',
            rate: BADGE_RATE,
            timeUnit: '1s',
            duration: DURATION,
            preAllocatedVUs: 50,
            maxVUs: 400,
          },
        }
      : {}),
    ...(BOTS > 0 ? { bots: { executor: 'constant-vus', exec: 'bot', vus: BOTS, duration: DURATION } } : {}),
    ...(AUTH === 'jwt' && REFRESH_RATE > 0
      ? {
          refresh: {
            executor: 'constant-arrival-rate',
            exec: 'refresh',
            rate: REFRESH_RATE,
            timeUnit: '1s',
            duration: DURATION,
            preAllocatedVUs: 20,
            maxVUs: 100,
          },
        }
      : {}),
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max', 'count'],
  thresholds: { op_failed: ['rate<0.01'] },
}

/** This VU's access tokens, by person, renewed a few minutes before they run out. */
const jwts = new Map<string, { jwt: string; until: number }>()

function bearer(person: Person): string | null {
  if (AUTH === 'token') {
    return person.token
  }
  const held = jwts.get(person.handle)
  if (held && held.until > Date.now()) {
    return held.jwt
  }
  // the token minted for this person before the run, while it has a few minutes left
  // seeded handles are p0 … p9999, in the seed's order
  const i = Number(person.handle.slice(1))
  const mintedAt = Number(minted[0])
  if (i >= 0 && minted[i + 1] && mintedAt + 12 * 60_000 > Date.now()) {
    jwts.set(person.handle, { jwt: minted[i + 1]!, until: mintedAt + 12 * 60_000 })
    return minted[i + 1]!
  }
  return renew(person)
}

/** A new access token from the person's session, as the web app gets one when its token runs out. */
function renew(person: Person): string | null {
  const response = http.get(`${base()}/api/auth/token`, {
    headers: { cookie: person.cookie, origin: ORIGIN, 'x-forwarded-for': person.ip },
    tags: { op: 'auth_token' },
  })
  record('auth_token', response)
  if (response.status !== 200) {
    return null
  }
  const jwt = (response.json() as { token: string }).token
  jwts.set(person.handle, { jwt, until: Date.now() + 12 * 60_000 })
  return jwt
}

function record(op: Op, response: http.RefinedResponse<http.ResponseType | undefined>) {
  times[op].add(response.timings.duration)
  if (response.status === 409) {
    stale.add(1, { op })
    return
  }
  const ok = response.status >= 200 && response.status < 300
  failed.add(!ok, { op })
  if (response.status === 429 || response.status === 503) {
    refusals.add(1, { op, status: String(response.status) })
  }
  check(response, { [`${op} answered`]: () => ok })
}

let keys = 0
/** One API call as `person`; its answer, or null if it failed. */
function call<T>(
  person: Person,
  op: Op,
  method: 'GET' | 'POST',
  path: string,
  input: Record<string, unknown> = {},
): T | null {
  const token = bearer(person)
  if (!token) {
    return null
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    'x-forwarded-for': person.ip,
  }
  let url = `${base()}/api${path}`
  let body: string | null = null
  if (method === 'GET') {
    const query = Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`)
    url += query.length > 0 ? `?${query.join('&')}` : ''
  } else {
    body = JSON.stringify(input)
    headers['content-type'] = 'application/json'
    headers['idempotency-key'] = `${exec.vu.idInTest}-${Date.now()}-${keys++}`
  }
  const response = http.request(method, url, body, { headers, tags: { op } })
  record(op, response)
  return response.status >= 200 && response.status < 300 ? (response.json() as T) : null
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!

/** A random idea from one of person i's teams: team t's ideas are t, t + teams, t + 2 × teams, … */
function ideaOf(i: number): string {
  const t = pick(memberTeams(i, teams.length))
  const count = Math.floor((ideas.length - 1 - t) / teams.length) + 1
  return ideas[t + teams.length * Math.floor(Math.random() * count)]!
}

/** People this VU's people have looked up, and until when: the web app keeps each for 10 minutes. */
const known = new Map<string, number>()

/** Names the people a page shows, as the web app does: those it hasn't looked up lately, in one request. */
function namePeople(person: Person, ids: string[]) {
  const now = Date.now()
  const wanted = [...new Set(ids)].filter((id) => (known.get(`${person.handle} ${id}`) ?? 0) < now).slice(0, 100)
  if (wanted.length === 0) {
    return
  }
  for (const id of wanted) {
    known.set(`${person.handle} ${id}`, now + 10 * 60_000)
  }
  call(person, 'get_people', 'POST', '/people/lookup', { ids: wanted })
}

type Caller = { user: string }
type IdeaPage = { idea: { owner: string; versions: Array<{ by: Caller }> } }
type Thread = { author: Caller; replies: Array<{ author: Caller }> }

/**
 * One page view by one of this VU's people, with the reads the web app's
 * loaders make for that page (packages/web/src/routes). The shell's own reads
 * (who you are, your teams) come only when the app loads afresh; the inbox
 * badge is the badge scenario.
 */
export function pageView() {
  const i = (exec.vu.idInTest - 1 + VUS * exec.vu.iterationInScenario) % people.length
  const person = people[i]!
  if (Math.random() < FRESH) {
    call(person, 'whoami', 'GET', '/me')
    call(person, 'list_my_memberships', 'GET', '/me/memberships')
  }
  const r = Math.random()
  if (r < 0.2) {
    // home: your ideas, and what's changed in the ideas you can see
    call(person, 'list_ideas', 'GET', '/ideas', { owner: person.id })
    call(person, 'list_ideas', 'GET', '/ideas')
  } else if (r < 0.35) {
    // the ideas page
    call(person, 'list_ideas', 'GET', '/ideas', { state: 'open' })
  } else if (r < 0.45) {
    // a team's page: the team, its open ideas, its members and how much of it you hear about
    const team = teams[pick(memberTeams(i, teams.length))]!
    call(person, 'get_team', 'GET', `/teams/${team}`)
    call(person, 'list_ideas', 'GET', '/ideas', { team, state: 'open' })
    call(person, 'list_team_members', 'GET', `/teams/${team}/members`)
    call(person, 'get_team_watch', 'GET', `/teams/${team}/watch`)
  } else if (r < 0.55) {
    call(person, 'search_ideas', 'GET', '/search/ideas', { q: pick(WORDS) })
  } else if (r < 0.7) {
    call(person, 'list_notifications', 'GET', '/notifications')
  } else if (r < 0.95) {
    // an idea's page: everything but the live comments in one read, then those, then the people they name
    const idea = ideaOf(i)
    const page = call<IdeaPage>(person, 'open_idea', 'GET', `/ideas/${idea}/page`)
    const threads = call<Thread[]>(person, 'list_comments', 'GET', `/ideas/${idea}/comments`) ?? []
    if (page) {
      namePeople(person, [
        page.idea.owner,
        ...page.idea.versions.map((v) => v.by.user),
        ...threads.flatMap((t) => [t.author.user, ...t.replies.map((c) => c.author.user)]),
      ])
    }
  } else if (r < 0.98) {
    const idea = ideaOf(i)
    const summary = call<{ latest: number }>(person, 'get_idea', 'GET', `/ideas/${idea}`)
    if (summary) {
      call(person, 'add_comment', 'POST', `/ideas/${idea}/comments`, {
        version: summary.latest,
        anchor: { kind: 'file', file: 'f1' },
        body: `A comment from ${person.handle}.`,
      })
    }
  } else {
    call(person, 'mark_notifications', 'POST', '/notifications/mark', { ideas: [ideaOf(i)], read: true })
  }
}

/** The inbox badge of someone with the app open, as its shell reads it once a minute. */
export function badge() {
  call(people[Math.floor(Math.random() * people.length)]!, 'count_unread_notifications', 'GET', '/notifications/unread')
}

/** One token renewal by someone whose token is running out: the refresh scenario, at LOAD_REFRESH_RATE a second. */
export function refresh() {
  renew(people[Math.floor(Math.random() * people.length)]!)
}

/** A bot's ideas and the version it last saw of each; per VU, as each bot is one VU. */
let mine: Array<{ idea: string; version: number }> | null = null
let turn = 0

/** One action by a bot: a comment or an edit on the next of its ideas, as fast as it's answered. */
export function bot() {
  // bot b works for team b's admin, on that team's ideas, which the admin made and can edit
  const t = (exec.vu.idInTest - 1) % teams.length
  const person = people[teamAdmin(t, people.length)]!
  if (!mine) {
    const count = Math.floor((ideas.length - 1 - t) / teams.length) + 1
    mine = Array.from({ length: Math.min(BOT_IDEAS, count) }, (_, k) => ({
      idea: ideas[t + teams.length * k]!,
      version: 0,
    }))
  }
  const target = mine[turn++ % mine.length]!
  if (target.version === 0) {
    target.version = call<{ latest: number }>(person, 'get_idea', 'GET', `/ideas/${target.idea}`)?.latest ?? 0
    if (target.version === 0) {
      return
    }
  }
  if (turn % 4 === 0) {
    // an edit batch, replayed onto the latest version if others moved it on
    const result = call<{ version: number }>(person, 'edit', 'POST', `/ideas/${target.idea}/edits`, {
      batch: { base: target.version, steps: [{ command: 'insert', at: { end: 'f1' }, markdown: `Bot note ${turn}.` }] },
    })
    target.version = result?.version ?? 0
  } else {
    const added = call(person, 'add_comment', 'POST', `/ideas/${target.idea}/comments`, {
      version: target.version,
      anchor: { kind: 'file', file: 'f1' },
      body: `Bot comment ${turn}.`,
    })
    if (!added) {
      // most likely stale_version: someone made a version; read it again next time
      target.version = 0
    }
  }
}
