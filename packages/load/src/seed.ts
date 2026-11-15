// Seeds a running deployment with the design scale's data through its public
// API: people (each signed in by an emailed code, read from Mailpit), teams,
// groups, memberships, ideas and comments. Resumable: what's made is kept in
// .data/seed.json, and a second run carries on from there. The k6 scripts act
// as these people.
//
//   bun packages/load/src/seed.ts            (see the README for the settings)
import { createApiClient, type ApiClient } from '@ideaf/api'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { groupMembers, ideaDocument, ideaTeam, ideaTitle, memberTeams, personIp, teamAdmin } from './model.ts'

const env = process.env
/** The app, reached directly (not through Caddy) from the Docker network's gateway, a trusted proxy. */
const APP = env.LOAD_APP_URL ?? 'http://localhost:18080'
/** The deployment's public URL (url): Better Auth checks a sign-in's Origin against it. */
const ORIGIN = env.LOAD_ORIGIN ?? 'https://localhost:18443'
const MAILPIT = env.LOAD_MAILPIT_URL ?? 'http://localhost:18025'
const STATE = env.LOAD_SEED ?? join(import.meta.dir, '../.data/seed.json')
// RivetKit slows down rather than up with too much in flight (README, Findings): 16 was the best measured
// for ideas (19 a second; 15 at 8, 16 at 64), and the app limits its own calls to the directory.
const CONCURRENCY = Number(env.LOAD_CONCURRENCY ?? 16)
const SCALE = {
  people: Number(env.LOAD_PEOPLE ?? 10_000),
  teams: Number(env.LOAD_TEAMS ?? 1_000),
  groups: Number(env.LOAD_GROUPS ?? 2_000),
  ideas: Number(env.LOAD_IDEAS ?? 100_000),
  /** One idea in this many gets comments, and one in this many is shared with a group. */
  commentEvery: 10,
  shareEvery: 10,
}

export interface Person {
  handle: string
  id: string
  ip: string
  /** The session cookie, swapped for 15-minute JWTs as the web app does. */
  cookie: string
  /** A personal token (ideaf_…), for LOAD_AUTH=token. */
  token: string
}

export interface Seed {
  scale: typeof SCALE
  people: Person[]
  teams: string[]
  groups: string[]
  /** Idea IDs, by index: idea j is in team ideaTeam(j). */
  ideas: string[]
  /** How many of each step are done, so a run carries on. */
  done: { members: number; groupMembers: number; shared: number; commented: number }
}

const seed: Seed = existsSync(STATE)
  ? (JSON.parse(readFileSync(STATE, 'utf8')) as Seed)
  : {
      scale: SCALE,
      people: [],
      teams: [],
      groups: [],
      ideas: [],
      done: { members: 0, groupMembers: 0, shared: 0, commented: 0 },
    }
if (seed.scale.people !== SCALE.people || seed.scale.teams !== SCALE.teams || seed.scale.ideas !== SCALE.ideas) {
  throw new Error(
    `${STATE} was seeded at another scale (${JSON.stringify(seed.scale)}): delete it, and the deployment's data, to start again`,
  )
}

let lastSave = 0
function save(force = false) {
  if (!force && Date.now() - lastSave < 5_000) {
    return
  }
  lastSave = Date.now()
  mkdirSync(dirname(STATE), { recursive: true })
  writeFileSync(`${STATE}.tmp`, JSON.stringify(seed))
  renameSync(`${STATE}.tmp`, STATE)
}

/** Where a list made in order carries on: its first gap (several are made at once, so a stop can leave one). */
const firstGap = (list: unknown[]) => {
  const gap = list.findIndex((x) => x === undefined || x === null)
  return gap === -1 ? list.length : gap
}

/**
 * Runs `work` on each index from `from` to `to`, `CONCURRENCY` at a time,
 * reporting progress. `record` is told how far everything is done without a
 * gap, which is where a later run carries on.
 */
async function each(
  label: string,
  from: number,
  to: number,
  work: (i: number) => Promise<void>,
  record: (doneUpTo: number) => void = () => {},
) {
  if (from >= to) {
    console.log(`${label}: done already (${to})`)
    return
  }
  const started = Date.now()
  let next = from
  let finished = from
  let failed = 0
  const ahead = new Set<number>()
  let upTo = from
  const report = setInterval(() => {
    const rate = (finished - from) / ((Date.now() - started) / 1000)
    console.log(`${label}: ${finished}/${to}, ${rate.toFixed(1)}/s, ${failed} failed`)
  }, 10_000)
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < to) {
        const i = next++
        try {
          await retrying(() => work(i))
          ahead.add(i)
          while (ahead.delete(upTo)) {
            upTo++
          }
          record(upTo)
        } catch (error) {
          failed++
          console.error(`${label} ${i}: ${error instanceof Error ? error.message : String(error)}`)
        }
        finished++
        save()
      }
    }),
  )
  clearInterval(report)
  save(true)
  console.log(`${label}: ${to} in ${((Date.now() - started) / 1000).toFixed(0)} s, ${failed} failed`)
  if (failed > 0) {
    throw new Error(`${label}: ${failed} failed; run again to carry on`)
  }
}

async function retrying<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      const status = (error as { status?: number }).status ?? 0
      if (attempt >= 4 || (status > 0 && status < 500 && status !== 429)) {
        throw error
      }
      await Bun.sleep(500 * 2 ** attempt)
    }
  }
}

/** A request to Better Auth, from a person's own address (through the trusted gateway). */
async function auth(path: string, ip: string, init: { body?: unknown; cookie?: string } = {}): Promise<Response> {
  const response = await fetch(`${APP}${path}`, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: {
      'x-forwarded-for': ip,
      origin: ORIGIN,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  if (!response.ok) {
    throw Object.assign(new Error(`${path}: ${response.status} ${await response.text()}`), { status: response.status })
  }
  return response
}

/** The sign-in code just sent to `email`, from Mailpit; the message is deleted once read. */
async function emailedCode(email: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const found = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    ).json()) as {
      messages: Array<{ ID: string; Snippet: string }>
    }
    const message = found.messages[0]
    if (message) {
      const text = ((await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as { Text: string }).Text
      await fetch(`${MAILPIT}/api/v1/messages`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ IDs: found.messages.map((m) => m.ID) }),
      })
      const code = /\b(\d{6})\b/.exec(text)?.[1]
      if (code) {
        return code
      }
    }
    await Bun.sleep(100)
  }
  throw new Error(`no sign-in code reached ${email}`)
}

async function signUp(i: number): Promise<Person> {
  const handle = `p${i}`
  const email = `${handle}@load.test`
  const ip = personIp(i)
  await auth('/api/auth/email-otp/send-verification-otp', ip, { body: { email, type: 'sign-in' } })
  const otp = await emailedCode(email)
  const session = await auth('/api/auth/sign-in/email-otp', ip, {
    body: { email, otp, username: handle, name: `Person ${i}` },
  })
  const cookie = session.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const { user } = (await session.json()) as { user: { id: string } }
  const { key } = (await (
    await auth('/api/auth/api-key/create', ip, {
      body: { configId: 'personal', name: 'load test', metadata: { purpose: 'me' } },
      cookie,
    })
  ).json()) as { key: string }
  return { handle, id: user.id, ip, cookie, token: key }
}

const jwts = new Map<string, { jwt: string; until: number }>()
/** A person's access token, from their session, as the web app gets one. */
async function jwtOf(person: Person): Promise<string> {
  const held = jwts.get(person.handle)
  if (held && held.until > Date.now()) {
    return held.jwt
  }
  const { token } = (await (await auth('/api/auth/token', person.ip, { cookie: person.cookie })).json()) as {
    token: string
  }
  jwts.set(person.handle, { jwt: token, until: Date.now() + 10 * 60_000 })
  return token
}

const clients = new Map<string, ApiClient>()
function as(person: Person): ApiClient {
  let client = clients.get(person.handle)
  if (!client) {
    client = createApiClient({
      baseUrl: APP,
      token: () => jwtOf(person),
      fetch: (request) => {
        request.headers.set('x-forwarded-for', person.ip)
        return fetch(request)
      },
      retries: 0,
    })
    clients.set(person.handle, client)
  }
  return client
}

const person = (i: number) => seed.people[i % seed.people.length]!
const admin = (t: number) => person(teamAdmin(t, SCALE.people))
/** The person who made group g, its first admin. */
const groupAdmin = (g: number) => person(g * 11)

console.log(`seeding ${APP} at ${JSON.stringify(SCALE)}, ${CONCURRENCY} at a time, into ${STATE}`)

await each('people', firstGap(seed.people), SCALE.people, async (i) => {
  if (seed.people[i]) {
    return
  }
  seed.people[i] = await signUp(i)
})

// a team's first admin is the person who made it; its members come from memberTeams
await each('teams', firstGap(seed.teams), SCALE.teams, async (t) => {
  if (seed.teams[t]) {
    return
  }
  const team = await as(admin(t)).createTeam({ handle: `t${t}`, name: `Team ${t}` })
  seed.teams[t] = team.id
})
await each(
  'team members',
  seed.done.members,
  SCALE.people,
  async (i) => {
    for (const t of memberTeams(i, SCALE.teams)) {
      if (teamAdmin(t, SCALE.people) === i) {
        continue
      }
      await as(admin(t)).addTeamMember({ team: seed.teams[t]!, user: person(i).handle, role: 'member' })
    }
  },
  (n) => {
    seed.done.members = n
  },
)

await each('groups', firstGap(seed.groups), SCALE.groups, async (g) => {
  if (seed.groups[g]) {
    return
  }
  const group = await as(groupAdmin(g)).createGroup({ handle: `g${g}`, name: `Group ${g}` })
  seed.groups[g] = group.id
})
await each(
  'group members',
  seed.done.groupMembers,
  SCALE.groups,
  async (g) => {
    for (const i of groupMembers(g, SCALE.people)) {
      if (person(i).handle !== groupAdmin(g).handle) {
        await as(groupAdmin(g)).addGroupMember({ group: seed.groups[g]!, user: person(i).handle, role: 'member' })
      }
    }
  },
  (n) => {
    seed.done.groupMembers = n
  },
)

// idea j is in team ideaTeam(j), made by that team's admin
await each('ideas', firstGap(seed.ideas), SCALE.ideas, async (j) => {
  if (seed.ideas[j]) {
    return
  }
  const t = ideaTeam(j, SCALE.teams)
  const created = await as(admin(t)).createIdea(
    {
      title: ideaTitle(j),
      description: `Load test idea ${j}.`,
      team: seed.teams[t]!,
      files: [{ path: 'idea.md', content: ideaDocument(j) }],
    },
    { idempotencyKey: `load-idea-${j}` },
  )
  seed.ideas[j] = created.idea
})

// every tenth idea shared with a group, to view
await each(
  'shared',
  seed.done.shared,
  Math.floor(SCALE.ideas / SCALE.shareEvery),
  async (k) => {
    const j = k * SCALE.shareEvery
    const t = ideaTeam(j, SCALE.teams)
    await as(admin(t)).setAccess({
      idea: seed.ideas[j]!,
      subject: { kind: 'group', id: seed.groups[k % SCALE.groups]! },
      access: { edit: false, share: false },
    })
  },
  (n) => {
    seed.done.shared = n
  },
)

// every tenth idea (offset by five) gets three comments from members of its team: inbox rows and emails
await each(
  'commented',
  seed.done.commented,
  Math.floor(SCALE.ideas / SCALE.commentEvery),
  async (k) => {
    const j = k * SCALE.commentEvery + 5
    const t = ideaTeam(j, SCALE.teams)
    for (let c = 0; c < 3; c++) {
      const commenter = person(t + SCALE.teams * (c + 1))
      const idea = seed.ideas[j]!
      const { latest } = await as(commenter).getIdea({ idea })
      await as(commenter).addComment(
        { idea, version: latest, anchor: { kind: 'file', file: 'f1' }, body: `Comment ${c} on idea ${j}.` },
        { idempotencyKey: `load-comment-${j}-${c}` },
      )
    }
  },
  (n) => {
    seed.done.commented = n
  },
)

console.log('seeded')
