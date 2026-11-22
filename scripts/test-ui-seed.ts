// Development only: loads scripts/test-ui-data.ts into the app scripts/test-ui.sh runs, through its
// public API, as the people in it: each signs in with a code emailed to Mailpit, then makes their
// teams, groups and ideas, comments, suggests, reviews and closes, as they would in the app. With
// `medium`, a generated company of about 150 people is added to it (scripts/test-ui-medium.ts). It
// takes seconds, and once: run scripts/test-ui.sh wipe and up to start again.
//
//   scripts/test-ui.sh seed [medium]
import { ApiError, createApiClient, type ApiClient } from '@ideaf/api'
import { parseMarkdown } from '@ideaf/core'
import * as small from './test-ui-data.ts'
import type { Discussion, IdeaSeed } from './test-ui-data.ts'
import { medium } from './test-ui-medium.ts'

const { people, groups, teams, joinRequests, ideas } = process.argv.includes('medium') ? medium(small) : small

const APP = process.env.TEST_UI_URL ?? 'http://localhost:28080'
const MAILPIT = process.env.TEST_UI_MAILPIT_URL ?? 'http://localhost:28025'

interface Person {
  handle: string
  id: string
  api: ApiClient
}

/** Everyone, by their handle in the data (the site admin's own handle may differ, if they signed in first). */
const everyone = new Map<string, Person>()
const who = (handle: string) => {
  const person = everyone.get(handle)
  if (!person) {
    throw new Error(`no one called ${handle} in test-ui-data.ts`)
  }
  return person
}
const groupIds = new Map<string, string>()

/**
 * Each person signs in from an address of their own, so sign-in's limits count them apart (test-ui.yaml
 * trusts it). They're in 198.18.0.0/15, set aside for tests: not a private network, which the app
 * would take for one more proxy to look past.
 */
const addressOf = (i: number) => `198.18.${Math.floor(i / 200)}.${(i % 200) + 10}`

async function auth(path: string, ip: string, body: unknown, cookie?: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${APP}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: APP,
        'x-forwarded-for': ip,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    })
    // Sign-in limits how many codes one address can ask for. If the app doesn't believe our
    // X-Forwarded-For (test-ui.yaml trusts the private networks), everyone counts as one
    // address and some get 429: wait and try again, so they get through a few at a time.
    if (response.status === 429 && attempt < 12) {
      await Bun.sleep(5_000)
      continue
    }
    if (response.status === 429) {
      throw new Error(
        `${path}: 429, still, after a minute: the app counts everyone as one address. Connections from this machine reach it from an address IDEAF__TRUSTED_PROXIES in scripts/test-ui.yaml doesn't cover; add its range there, then scripts/test-ui.sh up.`,
      )
    }
    if (!response.ok) {
      throw new Error(`${path}: ${response.status} ${await response.text()}`)
    }
    return response
  }
}

/** The sign-in code just sent to `email`; the email is deleted once read, so the next one is new. */
async function emailedCode(email: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const search = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    ).json()) as { messages: Array<{ ID: string; Subject: string }> }
    const code = search.messages.map((m) => /\b(\d{6})\b/.exec(m.Subject)?.[1]).find(Boolean)
    if (code) {
      await fetch(`${MAILPIT}/api/v1/messages`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ IDs: search.messages.map((m) => m.ID) }),
      })
      return code
    }
    await Bun.sleep(100)
  }
  throw new Error(`no sign-in code reached ${email} in Mailpit (${MAILPIT})`)
}

async function signIn(i: number): Promise<void> {
  const seed = people[i]!
  const ip = addressOf(i)
  await auth('/email-otp/send-verification-otp', ip, { email: seed.email, type: 'sign-in' })
  const otp = await emailedCode(seed.email)
  const session = await auth('/sign-in/email-otp', ip, {
    email: seed.email,
    otp,
    username: seed.handle,
    name: seed.name,
  })
  const cookie = session.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  let jwt: { token: string; until: number } | null = null
  const api = createApiClient({
    baseUrl: APP,
    // the session's short-lived token, as the web app gets it
    token: async () => {
      if (!jwt || jwt.until < Date.now()) {
        const response = await fetch(`${APP}/api/auth/token`, { headers: { cookie, 'x-forwarded-for': ip } })
        jwt = { token: ((await response.json()) as { token: string }).token, until: Date.now() + 10 * 60_000 }
      }
      return jwt.token
    },
    fetch: (request) => {
      request.headers.set('x-forwarded-for', ip)
      return fetch(request)
    },
  })
  const me = await api.me({})
  everyone.set(seed.handle, { handle: me.handle, id: me.id, api })
}

/** Runs `work` on each item, a few at a time. */
async function each<T>(items: T[], work: (item: T, i: number) => Promise<void>, at = 6) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(at, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        await work(items[i]!, i)
      }
    }),
  )
}

/** @person or group:handle as a grant's subject. */
function subject(to: string) {
  if (to === 'everyone') {
    return { kind: 'everyone' as const }
  }
  if (to.startsWith('group:')) {
    return { kind: 'group' as const, id: groupIds.get(to.slice('group:'.length))! }
  }
  return { kind: 'user' as const, id: who(to.replace(/^@/, '')).id }
}

/** The idea's latest version and its files, by path. */
async function latest(api: ApiClient, idea: string) {
  const pulled = await api.pull({ idea })
  return { version: pulled.version, files: new Map(pulled.files.map((f) => [f.path, f])) }
}

/** Where a discussion is: a file, text in it (its plain text, as the app counts it), a section or a block. */
async function anchorOf(api: ApiClient, idea: string, seed: IdeaSeed, d: Discussion) {
  const now = await latest(api, idea)
  const path = d.file ?? Object.keys(seed.files)[0]!
  const file = now.files.get(path)
  if (!file) {
    throw new Error(`${seed.title}: no file ${path}`)
  }
  if (d.section !== undefined || d.block !== undefined) {
    // by their IDs, as show_blocks gives them: a section by its heading's words, a block by words it has
    const outline = await api.showBlocks({ idea })
    const entries = outline.files.find((f) => f.id === file.file)?.entries ?? []
    const found =
      d.section !== undefined
        ? entries.find((e) => e.kind === 'heading' && e.source.replace(/^#+\s*/, '').trim() === d.section)
        : entries.find((e) => e.kind !== 'heading' && e.source.includes(d.block!))
    if (!found) {
      throw new Error(
        `${seed.title}: no ${d.section !== undefined ? `section "${d.section}"` : `block with "${d.block}"`} in ${path}`,
      )
    }
    return {
      version: now.version,
      anchor:
        d.section !== undefined
          ? { kind: 'section' as const, section: found.id }
          : { kind: 'block' as const, block: found.id },
    }
  }
  if (!d.on) {
    return { version: now.version, anchor: { kind: 'file' as const, file: file.file } }
  }
  const start = parseMarkdown(file.content).plain.text.indexOf(d.on)
  if (start < 0) {
    throw new Error(`${seed.title}: "${d.on}" isn't in ${path}`)
  }
  return {
    version: now.version,
    anchor: { kind: 'text' as const, file: file.file, start, end: start + d.on.length },
  }
}

/** An idea made, as its author: its number is the next in its team, or its author's. */
async function createIdea(seed: IdeaSeed): Promise<string> {
  const created = await who(seed.by).api.createIdea({
    title: seed.title,
    ...(seed.description ? { description: seed.description } : {}),
    ...(seed.team ? { team: seed.team } : {}),
    files: Object.entries(seed.files).map(([path, content]) => ({ path, content })),
    ...(seed.review ? { status: 'requesting-review' as const } : {}),
  })
  return created.idea
}

/** The rest of an idea made: its sharing, reviewers, discussion, versions, reviews and end. */
async function fillIdea(seed: IdeaSeed, idea: string) {
  const author = who(seed.by)
  for (const share of seed.share ?? []) {
    await author.api.setAccess({
      idea,
      subject: subject(share.to),
      access: { edit: share.edit ?? false, share: false },
    })
  }
  for (const reviewer of seed.reviewers ?? []) {
    const s = subject(reviewer)
    if (s.kind !== 'everyone') {
      await author.api.setReviewer({ idea, subject: s, reviewer: true })
    }
  }

  for (const d of seed.discussion ?? []) {
    const person = who(d.by)
    const { version, anchor } = await anchorOf(person.api, idea, seed, d)
    let comment: string
    if (d.suggest !== undefined && anchor.kind === 'text') {
      comment = (
        await person.api.suggestEdit({
          idea,
          version,
          anchor,
          new: d.suggest,
          ...(d.body ? { body: d.body } : {}),
          ...(d.pending ? { pending: true } : {}),
        })
      ).comment
    } else {
      comment = (
        await person.api.addComment({ idea, version, anchor, body: d.body, ...(d.pending ? { pending: true } : {}) })
      ).comment
    }
    for (const reply of d.replies ?? []) {
      await who(reply.by).api.reply({ idea, comment, body: reply.body })
    }
    if (d.accepted) {
      await author.api.acceptSuggestions({ idea, suggestions: [comment] })
    }
    if (d.resolved) {
      await author.api.resolveComment({ idea, comment, resolved: true })
    }
  }

  // each a version of its own, in order
  for (const version of seed.versions ?? []) {
    const by = version.by ? who(version.by) : author
    const now = await latest(by.api, idea)
    const edited = new Map<string, string>()
    for (const [old, replacement] of version.changes) {
      const path = [...now.files.keys()].find((p) => (edited.get(p) ?? now.files.get(p)!.content).includes(old))
      if (!path) {
        throw new Error(`${seed.title}: "${old}" isn't in any of its files`)
      }
      edited.set(path, (edited.get(path) ?? now.files.get(path)!.content).replace(old, replacement))
    }
    await by.api.sync({
      idea,
      files: [...edited].map(([path, content]) => {
        const file = now.files.get(path)!
        return { file: file.file, path, content, base: file.hash }
      }),
    })
  }

  for (const review of seed.reviews ?? []) {
    const { version } = await latest(who(review.by).api, idea)
    await who(review.by).api.reviewIdea({
      idea,
      version,
      verdict: review.verdict,
      ...(review.body ? { body: review.body } : {}),
    })
  }

  if (seed.ends && 'status' in seed.ends) {
    await author.api.setStatus({ idea, status: seed.ends.status, note: seed.ends.note })
  } else if (seed.ends) {
    await author.api.closeIdea({
      idea,
      reason: seed.ends.close,
      ...(seed.ends.note ? { note: seed.ends.note } : {}),
    })
  }
}

const started = Date.now()
const health = await fetch(`${APP}/health`).catch(() => null)
if (!health?.ok) {
  console.error(`the app isn't answering at ${APP}: scripts/test-ui.sh up`)
  process.exit(1)
}

// each from an address of its own, so many at once
await each(people, (_, i) => signIn(i), 24)
console.log(`${people.length} people signed in`)

// once only: what's made can't be made again
const admin = who(teams[0]!.admin).api
try {
  await admin.getTeam({ team: teams[0]!.handle })
  console.error(
    `team:${teams[0]!.handle} is there already: it's been seeded. To start again, scripts/test-ui.sh wipe, then up and seed.`,
  )
  process.exit(1)
} catch (error) {
  if (!(error instanceof ApiError && error.code === 'not_found')) {
    throw error
  }
}

await each(groups, async (g) => {
  const api = who(g.admin).api
  const made = await api.createGroup({ handle: g.handle, name: g.name, description: g.description })
  groupIds.set(g.handle, made.id)
  for (const [handle, role] of Object.entries(g.members)) {
    await api.addGroupMember({ group: g.handle, user: who(handle).id, role })
  }
})
await each(teams, async (t) => {
  const api = who(t.admin).api
  await api.createTeam({ handle: t.handle, name: t.name, description: t.description })
  for (const [handle, role] of Object.entries(t.members)) {
    await api.addTeamMember({ team: t.handle, user: who(handle).id, role })
  }
  for (const [group, role] of Object.entries(t.groups ?? {})) {
    await api.addTeamGroup({ team: t.handle, group, role })
  }
  await api.updateTeam({
    team: t.handle,
    defaults: {
      members: 'edit',
      public: t.public ?? false,
      groups: (t.sharedWith ?? []).map((group) => ({ group: groupIds.get(group)!, edit: false })),
    },
  })
  await api.setTeamRequirements({
    team: t.handle,
    requirements: {
      approvals: t.requirements.approvals,
      groups: t.requirements.anyOf ? [{ mode: 'any', groups: t.requirements.anyOf, request: true }] : [],
      resolved: t.requirements.resolved,
    },
  })
})
console.log(`${groups.length} groups and ${teams.length} teams`)

for (const r of joinRequests) {
  const api = who(r.by).api
  if (r.team) {
    await api.requestToJoinTeam({ team: r.team })
  }
  if (r.group) {
    await api.requestToJoinGroup({ group: r.group })
  }
}

// what building the teams and groups told everyone (who added them, which group joined which team) is read,
// as it would be by now: lastChanges, at the end, leaves riley a few unread
await each(
  people,
  async (p) => {
    await who(p.handle).api.markNotifications({ read: true })
  },
  24,
)

// made one at a time, in the order they're written, so each has the same number on every seed
// (mobile/idea/1 is always the same idea); then filled in, a few at a time
const made = new Map<IdeaSeed, string>()
for (const seed of ideas) {
  made.set(seed, await createIdea(seed))
}
await each(
  ideas,
  async (seed) => {
    try {
      await fillIdea(seed, made.get(seed)!)
    } catch (error) {
      throw new Error(`${seed.title}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  },
  12,
)
const comments = ideas.reduce(
  (n, i) => n + (i.discussion ?? []).reduce((m, d) => m + 1 + (d.replies?.length ?? 0), 0),
  0,
)
console.log(`${ideas.length} ideas, with ${comments} comments and replies`)

for (const change of small.lastChanges) {
  const api = who(change.by).api
  if ('groupJoins' in change) {
    await api.addTeamGroup(change.groupJoins)
  } else if ('groupLeaves' in change) {
    await api.removeTeamGroup(change.groupLeaves)
  } else if ('adds' in change) {
    const { team, group, person } = change.adds
    await (team
      ? api.addTeamMember({ team, user: who(person).id })
      : api.addGroupMember({ group: group!, user: who(person).id }))
  } else {
    const { team, group, person } = change.removes
    await (team
      ? api.removeTeamMember({ team, user: who(person).id })
      : api.removeGroupMember({ group: group!, user: who(person).id }))
  }
}
console.log(`${small.lastChanges.length} changes to teams and groups, for riley's notices`)
console.log(
  `seeded in ${((Date.now() - started) / 1000).toFixed(0)} s: sign in as ${people[0]!.email} (${people[0]!.name}), or anyone in scripts/test-ui-data.ts`,
)
