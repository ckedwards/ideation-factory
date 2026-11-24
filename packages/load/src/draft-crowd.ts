// A crowd in one live draft (docs/handoff-live-editing.md, step 4): how many browser windows can type
// in the same idea's draft at once before typing lags. It sets the default for limits.draft.editors,
// and measures what a deployment's own hardware takes: every keystroke and caret move goes to
// everyone in the draft, so the work grows with the square of the windows.
//
// Each window is what the page editor does, without a browser: the draft's socket, the editor's own
// document and collab (ui's editor/model and editor/collab), a keystroke every so often at the end of
// a paragraph of its own, and its caret after each, sent at most every caretMs as the page does. For
// each crowd size it reports how long a keystroke takes to be stored and come back (what turns the
// saving line back to Saved, and about when everyone else sees it), how often a send was behind and
// had to go again, and how long a caret takes to reach everyone.
//
// Against any running app, with Mailpit for signing in (the load stack's, or scripts/test-ui.sh's).
// The app's limit has to be above the largest crowd, or windows past it only read along:
//
//   IDEAF__LIMITS__DRAFT__EDITORS=1000 on the app, then
//   LOAD_APP_URL=http://localhost:18080 LOAD_MAIL_URL=http://localhost:18025 \
//     bun packages/load/src/draft-crowd.ts --windows 5,10,20,40 --seconds 30 --cps 3
import { parseArgs } from 'node:util'
import { createApiClient, type DraftLiveEvent } from '@ideaf/api'
import { collab, getVersion, receiveTransaction, sendableSteps } from '@ideaf/ui/editor/collab'
import { EditorState, type Node, pageDocument, Step } from '@ideaf/ui/editor/model'

const env = process.env
const APP = env.LOAD_APP_URL ?? 'http://localhost:18080'
const MAIL = env.LOAD_MAIL_URL ?? 'http://localhost:18025'
const ORIGIN = env.LOAD_ORIGIN ?? APP

const { values } = parseArgs({
  options: {
    windows: { type: 'string', default: '5,10,20,40' },
    seconds: { type: 'string', default: '30' },
    // keystrokes a second, each window: sustained typing is 2 to 5
    cps: { type: 'string', default: '3' },
    paragraphs: { type: 'string', default: '40' },
  },
})
const crowds = values.windows.split(',').map(Number)
const seconds = Number(values.seconds)
const cps = Number(values.cps)
const paragraphs = Number(values.paragraphs)

// ---- signing in, as a person does: a code by email, then a token from the session ----

async function auth(path: string, body: unknown, cookie?: string): Promise<Response> {
  const response = await fetch(`${APP}/api/auth${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin: ORIGIN,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${await response.text()}`)
  }
  return response
}

async function codeFor(email: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const found = (await (
      await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    ).json()) as { messages: Array<{ Subject: string }> }
    const code = found.messages.map((m) => /\b(\d{6})\b/.exec(m.Subject)?.[1]).find(Boolean)
    if (code) {
      return code
    }
    await Bun.sleep(100)
  }
  throw new Error(`no sign-in code for ${email} in Mailpit at ${MAIL}`)
}

async function signIn(): Promise<{ cookie: string; token: () => Promise<string> }> {
  const handle = `draft-crowd-${Date.now().toString(36)}`
  const email = `${handle}@example.test`
  await auth('/email-otp/send-verification-otp', { email, type: 'sign-in' })
  const session = await auth('/sign-in/email-otp', {
    email,
    otp: await codeFor(email),
    username: handle,
    name: 'Draft crowd',
  })
  const cookie = session.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const token = async () => ((await (await auth('/token', undefined, cookie)).json()) as { token: string }).token
  return { cookie, token }
}

// ---- one window ----

interface Measured {
  /** Each keystroke, typed to stored and back, in ms. */
  stored: number[]
  /** Each caret sent, to its echo from the actor, in ms. */
  carets: number[]
  sends: number
  behind: number
  closed: number[]
  joined: boolean
}

const schemaPromise = pageDocument('', []).then((d) => d.schema)

class Window {
  readonly window = `w-${crypto.randomUUID()}`
  readonly client = `c${Math.random().toString(36).slice(2, 10)}`
  measured: Measured = { stored: [], carets: [], sends: 0, behind: 0, closed: [], joined: false }
  #ws!: WebSocket
  #state: EditorState | null = null
  #inFlight = false
  #typedAt: number[] = []
  #caretMs = 80
  #caretAt = 0
  #caretSentAt: number | null = null
  #opened!: Promise<void>

  constructor(
    readonly idea: string,
    readonly paragraph: number,
  ) {}

  async open(token: string): Promise<void> {
    const schema = await schemaPromise
    this.#ws = new WebSocket(`${APP.replace(/^http/, 'ws')}/api/ideas/${this.idea}/draft/live`)
    let opened!: () => void
    this.#opened = new Promise((resolve) => (opened = resolve))
    this.#ws.onopen = () => this.#ws.send(JSON.stringify({ type: 'token', token, window: this.window }))
    this.#ws.onclose = ({ code }) => this.measured.closed.push(code)
    this.#ws.onmessage = ({ data }) => {
      const event = JSON.parse(String(data)) as DraftLiveEvent
      switch (event.type) {
        case 'ready':
          this.measured.joined = event.joined
          this.#caretMs = event.caretMs
          this.#ws.send(JSON.stringify({ type: 'open', file: 'f1' }))
          return
        case 'opened':
          this.#state = EditorState.create({
            doc: schema.nodeFromJSON(event.doc),
            plugins: [collab({ version: event.version, clientID: this.client })],
          })
          opened()
          return
        case 'steps': {
          if (!this.#state || event.from > getVersion(this.#state)) {
            if (this.#state) {
              this.#since()
            }
            return
          }
          const skip = getVersion(this.#state) - event.from
          const steps = event.steps.slice(skip).map((s) => Step.fromJSON(schema, s))
          const clients = event.clients.slice(skip)
          if (steps.length === 0) {
            return
          }
          this.#state = this.#state.apply(receiveTransaction(this.#state, steps, clients))
          const mine = clients.filter((c) => c === this.client).length
          if (mine > 0) {
            const now = performance.now()
            for (const typed of this.#typedAt.splice(0, mine)) {
              this.measured.stored.push(now - typed)
            }
            this.#inFlight = false
            this.#send()
          }
          return
        }
        case 'behind':
          this.measured.behind++
          this.#inFlight = false
          if (this.#state && event.version > getVersion(this.#state)) {
            this.#since()
          } else {
            this.#send()
          }
          return
        case 'presence':
          if (event.person.window === this.window && event.person.at && this.#caretSentAt !== null) {
            this.measured.carets.push(performance.now() - this.#caretSentAt)
            this.#caretSentAt = null
          }
          return
      }
    }
    await this.#opened
  }

  #since() {
    this.#ws.send(JSON.stringify({ type: 'since', file: 'f1', version: getVersion(this.#state!) }))
  }

  #send() {
    if (this.#inFlight || !this.#state || !this.measured.joined) {
      return
    }
    const sendable = sendableSteps(this.#state)
    if (!sendable) {
      return
    }
    this.#inFlight = true
    this.measured.sends++
    this.#ws.send(
      JSON.stringify({
        type: 'steps',
        file: 'f1',
        version: sendable.version,
        steps: sendable.steps.map((s) => s.toJSON()),
        client: this.client,
      }),
    )
  }

  /** A keystroke at the end of this window's paragraph, and the caret after it. */
  type(): void {
    if (!this.#state || !this.measured.joined) {
      return
    }
    const end = endOf(this.#state.doc, this.paragraph)
    this.#state = this.#state.apply(this.#state.tr.insertText('x', end))
    this.#typedAt.push(performance.now())
    this.#send()
    const now = performance.now()
    if (now - this.#caretAt >= this.#caretMs) {
      this.#caretAt = now
      this.#caretSentAt ??= now
      const at = endOf(this.#state.doc, this.paragraph)
      this.#ws.send(
        JSON.stringify({ type: 'here', at: { file: 'f1', anchor: at, head: at, version: getVersion(this.#state) } }),
      )
    }
  }

  /** Whether everything typed here is stored. */
  settled(): boolean {
    return this.#typedAt.length === 0
  }

  close(): void {
    this.#ws.close()
  }
}

/** Where the text of the heading's `n`th paragraph after it ends. */
function endOf(doc: Node, n: number): number {
  let pos = 0
  let end = 0
  doc.forEach((child, offset, index) => {
    if (index === 1 + n) {
      end = offset + child.nodeSize - 1
    }
    pos = offset
  })
  return end || pos
}

// ---- a crowd ----

const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) {
    return Number.NaN
  }
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
}
const ms = (x: number) => (Number.isNaN(x) ? '-' : `${Math.round(x)} ms`)

async function crowd(size: number, session: Awaited<ReturnType<typeof signIn>>) {
  const token = await session.token()
  const api = createApiClient({ baseUrl: APP, token })
  const body = Array.from({ length: paragraphs }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n')
  const { idea } = await api.createIdea({
    title: `Draft crowd of ${size}`,
    files: [{ path: 'plan.md', content: `# Plan\n\n${body}\n` }],
  })
  const windows = Array.from({ length: size }, (_, i) => new Window(idea, i % paragraphs))
  // in a few at a time, as people arrive
  for (let i = 0; i < windows.length; i += 10) {
    await Promise.all(windows.slice(i, i + 10).map((w) => w.open(token)))
  }
  const joined = windows.filter((w) => w.measured.joined).length
  const timers = windows.map((w) => {
    const every = 1000 / cps
    // each at its own pace around the rate, not in step with the others
    const tick = () => {
      w.type()
      timer = setTimeout(tick, every * (0.5 + Math.random()))
    }
    let timer = setTimeout(tick, Math.random() * every)
    return () => clearTimeout(timer)
  })
  await Bun.sleep(seconds * 1000)
  timers.forEach((stop) => stop())
  // what's on its way, stored
  for (let i = 0; i < 100 && !windows.every((w) => w.settled()); i++) {
    await Bun.sleep(100)
  }
  const unsettled = windows.filter((w) => !w.settled()).length
  windows.forEach((w) => w.close())
  const all = (key: 'stored' | 'carets') => windows.flatMap((w) => w.measured[key])
  const stored = all('stored')
  const carets = all('carets')
  const sends = windows.reduce((n, w) => n + w.measured.sends, 0)
  const behind = windows.reduce((n, w) => n + w.measured.behind, 0)
  const closed = windows.flatMap((w) => w.measured.closed).filter((c) => c !== 1000 && c !== 1005)
  return {
    windows: size,
    joined,
    keystrokes: stored.length,
    perSecond: Math.round(stored.length / seconds),
    storedP50: quantile(stored, 0.5),
    storedP95: quantile(stored, 0.95),
    storedP99: quantile(stored, 0.99),
    storedMax: quantile(stored, 1),
    behind: sends ? behind / sends : 0,
    caretP50: quantile(carets, 0.5),
    caretP95: quantile(carets, 0.95),
    unsettled,
    closed: closed.length,
  }
}

const session = await signIn()
console.log(`draft crowd: ${APP}, ${seconds} s each, ${cps} keystrokes a second a window`)
console.log(
  'windows  in  keys/s  stored p50  p95       p99       max       behind  caret p50  p95       unsent  dropped',
)
for (const size of crowds) {
  const r = await crowd(size, session)
  console.log(
    [
      String(r.windows).padEnd(8),
      String(r.joined).padEnd(3),
      String(r.perSecond).padEnd(7),
      ms(r.storedP50).padEnd(11),
      ms(r.storedP95).padEnd(9),
      ms(r.storedP99).padEnd(9),
      ms(r.storedMax).padEnd(9),
      `${Math.round(r.behind * 100)}%`.padEnd(7),
      ms(r.caretP50).padEnd(10),
      ms(r.caretP95).padEnd(9),
      String(r.unsettled).padEnd(7),
      String(r.closed),
    ].join(' '),
  )
}
