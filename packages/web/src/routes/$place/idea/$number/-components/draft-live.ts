// The draft's live socket, as the page uses it (/api/ideas/{idea}/draft/live; the server's
// draft-live.ts): open while the draft is being edited, one for every file the page has open (the
// focus view has them all). Each file is a live document (ui's editor/live.ts), which the page
// editor attaches to; this carries their steps both ways.
//
// - **Dropped,** every file goes offline and keeps its typing; it connects again (waiting longer
//   each time, up to half a minute, or once the browser says it's back online), opens its files
//   again and each catches up from its count. The browser going offline closes it at once.
// - **Edit access gone** (4403), or the idea (4404): every file closes, and the page is told.
//
// The page's window is one entity in the draft (step 4), the same one after a reconnect. It's told
// who else is in (each window, in the order they arrived, with its color) and where their carets
// are, which go to the file each is in; it sends its own caret at most every `caretMs` the server
// gives, and every few seconds while it stays put, so the server knows it's still here. Offline,
// everyone else is gone from the page until it's back. Past the draft's limit of windows it isn't
// in: the page shows the draft read-only, still live, until the server lets it in. Steps an agent
// made (step 7) go to the file with the agent's name, for the editor to mark them.
import { type Caller, type DraftCaret, DRAFT_LIVE_CLOSE, DraftLiveEvent, type DraftPresence } from '@ideaf/api'
import { LiveDoc } from '@ideaf/ui/editor/live'

/** How often a window that stays put says it's still here (the server forgets one after 30 seconds). */
const STILL_HERE_MS = 10_000

export interface DraftLiveDeps {
  /** A WebSocket to a path on this site. */
  open: (path: string) => WebSocket
  /** The session's token, fresh. */
  token: () => Promise<string>
  /**
   * A version was made, by whom: the draft committed (`committed`), or one made around it, which
   * overwrote `overwrote` of the draft's changes.
   */
  onVersion?: (version: number, by: Caller, committed: boolean, overwrote: number) => void
  /** Someone discarded the draft. */
  onDiscarded?: (by: Caller) => void
  /** Edit access is gone, or the idea. */
  onClosed?: (why: 'forbidden' | 'gone') => void
  /** Typing in a file was refused, and why. */
  onRefused?: (file: string, message: string) => void
  /** How often the token is sent again. */
  tokenEveryMs?: number
}

export class DraftLive {
  /** This page's window, as the draft knows it. */
  readonly window = `w-${crypto.randomUUID()}`
  #idea: string
  #deps: DraftLiveDeps
  #ws: WebSocket | null = null
  #ready = false
  #stopped = false
  #retry = 0
  #retryTimer: ReturnType<typeof setTimeout> | undefined
  #refresh: ReturnType<typeof setInterval> | undefined
  #docs = new Map<string, LiveDoc>()
  #opening = new Map<string, { resolve: (doc: LiveDoc) => void; reject: (error: Error) => void }[]>()
  #closed: 'forbidden' | 'gone' | null = null
  // who's in the draft, in the order they arrived (this window too), and whether this window is
  #people = new Map<string, DraftPresence>()
  #joined = false
  #limit = 0
  #caretMs = 80
  #listeners = new Set<() => void>()
  #revision = 0
  #nameOf: (user: string) => string = () => 'Someone'
  // this window's caret: the last sent, and one waiting for the next turn
  #here: DraftCaret | null = null
  #hereWaiting = false
  #hereTimer: ReturnType<typeof setTimeout> | undefined
  #stillHere: ReturnType<typeof setInterval> | undefined

  constructor(idea: string, deps: DraftLiveDeps) {
    this.#idea = idea
    this.#deps = deps
    this.#connect()
    this.#refresh = setInterval(() => void this.#sendToken(), deps.tokenEveryMs ?? 30_000)
    this.#stillHere = setInterval(() => {
      if (this.#ready && this.#joined) {
        this.#send({ type: 'here', at: this.#here })
      }
    }, STILL_HERE_MS)
    // the browser knows it's offline before a socket finds out: closed now, and open again once it's back
    window.addEventListener('offline', this.#offline)
    window.addEventListener('online', this.#online)
  }

  #offline = () => {
    this.#ws?.close()
  }

  #online = () => {
    if (this.#stopped || this.#closed || this.#ws?.readyState === WebSocket.OPEN) {
      return
    }
    clearTimeout(this.#retryTimer)
    this.#retry = 0
    this.#connect()
  }

  /** A file's live document, once the server has sent it (the same one each time). */
  open(file: string): Promise<LiveDoc> {
    const had = this.#docs.get(file)
    if (had) {
      return Promise.resolve(had)
    }
    if (this.#closed) {
      return Promise.reject(new Error('you can no longer edit this idea'))
    }
    return new Promise((resolve, reject) => {
      const waiting = this.#opening.get(file)
      if (waiting) {
        waiting.push({ resolve, reject })
        return
      }
      this.#opening.set(file, [{ resolve, reject }])
      if (this.#ready) {
        this.#send({ type: 'open', file })
      }
    })
  }

  /** Opens a file again from the server's document as it is now (after a long gap), dropping what's unsent. */
  reopen(file: string): void {
    this.#send({ type: 'open', file })
  }

  /** Whether edit access (or the idea) is gone. */
  closed(): 'forbidden' | 'gone' | null {
    return this.#closed
  }

  /** The other windows in the draft, in the order they arrived (empty while offline). */
  people(): DraftPresence[] {
    return [...this.#people.values()].filter((p) => p.window !== this.window)
  }

  /** Whether this window is in the draft and can type: false while it's full (or before the server's said). */
  joined(): boolean {
    return this.#joined
  }

  /** How many windows the draft takes. */
  limit(): number {
    return this.#limit
  }

  /** A number that changes whenever what subscribe tells of does (a snapshot for React). */
  revision(): number {
    return this.#revision
  }

  /** Called whenever who's in the draft, where they are, or whether this window's in, changes. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** How each person's named on their caret (the page knows people's names). */
  setNames(nameOf: (user: string) => string): void {
    this.#nameOf = nameOf
    for (const person of this.#people.values()) {
      this.#route(person)
    }
  }

  /** An agent's name, as its edits are marked in the text ("Claude for Tomás", or "for you"); null for a person. */
  #agentOf(by: Caller | null): string | null {
    if (!by || by.purpose === 'me') {
      return null
    }
    const bot = by.bot ?? 'bot'
    if (by.purpose !== 'bot-for-me') {
      return bot
    }
    // your own agent is "for you", in the middle of the name as in a sentence
    const mine = this.#people.get(this.window)?.user === by.user
    return `${bot} for ${mine ? 'you' : this.#nameOf(by.user)}`
  }

  #changed() {
    this.#revision++
    for (const listener of this.#listeners) {
      listener()
    }
  }

  /** A window's caret to the file it's in, and out of the others. */
  #route(person: DraftPresence) {
    if (person.window === this.window) {
      return
    }
    for (const [file, doc] of this.#docs) {
      const at = person.at
      if (at && at.file === file) {
        doc.presence(person.window, {
          anchor: at.anchor,
          head: at.head,
          version: at.version,
          name: this.#nameOf(person.user),
          color: person.color,
        })
      } else if (doc.present().includes(person.window)) {
        doc.presence(person.window, null)
      }
    }
  }

  #gone(window: string) {
    this.#people.delete(window)
    for (const doc of this.#docs.values()) {
      if (doc.present().includes(window)) {
        doc.presence(window, null)
      }
    }
  }

  #everyone(people: DraftPresence[]) {
    for (const window of this.#people.keys()) {
      this.#gone(window)
    }
    for (const person of people) {
      this.#people.set(person.window, person)
      this.#route(person)
    }
  }

  /** This window's caret moved, in a file: sent now, or at the end of this turn (at most every caretMs). */
  #moved(at: DraftCaret) {
    this.#here = at
    if (this.#hereTimer) {
      this.#hereWaiting = true
      return
    }
    this.#sendHere()
  }

  #sendHere() {
    if (this.#ready && this.#joined) {
      this.#send({ type: 'here', at: this.#here })
    }
    this.#hereTimer = setTimeout(() => {
      this.#hereTimer = undefined
      if (this.#hereWaiting) {
        this.#hereWaiting = false
        this.#sendHere()
      }
    }, this.#caretMs)
  }

  stop(): void {
    this.#stopped = true
    window.removeEventListener('offline', this.#offline)
    window.removeEventListener('online', this.#online)
    clearInterval(this.#refresh)
    clearInterval(this.#stillHere)
    clearTimeout(this.#retryTimer)
    clearTimeout(this.#hereTimer)
    this.#ws?.close()
  }

  #send(message: unknown) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(message))
    }
  }

  async #sendToken() {
    const ws = this.#ws
    if (ws?.readyState !== WebSocket.OPEN) {
      return
    }
    ws.send(JSON.stringify({ type: 'token', token: await this.#deps.token(), window: this.window }))
  }

  #connect() {
    const ws = this.#deps.open(`/api/ideas/${encodeURIComponent(this.#idea)}/draft/live`)
    this.#ws = ws
    ws.onopen = () => void this.#sendToken()
    ws.onmessage = ({ data }) => this.#message(DraftLiveEvent.parse(JSON.parse(String(data))))
    ws.onclose = ({ code }) => {
      this.#ready = false
      for (const doc of this.#docs.values()) {
        doc.online(false)
      }
      // offline, everyone else's caret and face is gone until it's back
      this.#everyone([])
      this.#changed()
      if (this.#stopped) {
        return
      }
      if (code === DRAFT_LIVE_CLOSE.forbidden || code === DRAFT_LIVE_CLOSE.notFound) {
        this.#closed = code === DRAFT_LIVE_CLOSE.forbidden ? 'forbidden' : 'gone'
        for (const doc of this.#docs.values()) {
          doc.close()
        }
        for (const waiting of this.#opening.values()) {
          waiting.forEach((w) => w.reject(new Error('you can no longer edit this idea')))
        }
        this.#opening.clear()
        this.#deps.onClosed?.(this.#closed)
        return
      }
      // again, waiting longer each time up to half a minute (or as soon as the browser's back online);
      // back, each file catches up
      if (navigator.onLine) {
        this.#retryTimer = setTimeout(() => this.#connect(), Math.min(30_000, 500 * 2 ** this.#retry++))
      }
    }
  }

  #message(event: DraftLiveEvent) {
    switch (event.type) {
      case 'ready':
        this.#ready = true
        this.#retry = 0
        this.#joined = event.joined
        this.#limit = event.limit
        this.#caretMs = event.caretMs
        this.#everyone(event.people)
        this.#changed()
        // back: where this window's caret was
        if (this.#joined && this.#here) {
          this.#send({ type: 'here', at: this.#here })
        }
        // the files open here, again: each catches up from its count, and sends what's left
        for (const file of this.#docs.keys()) {
          this.#send({ type: 'open', file })
        }
        for (const doc of this.#docs.values()) {
          doc.online(true)
        }
        for (const file of this.#opening.keys()) {
          this.#send({ type: 'open', file })
        }
        return
      case 'opened': {
        const had = this.#docs.get(event.file)
        if (had) {
          // opened again after a long gap: the server's document as it is now
          if (had.status() === 'gone') {
            had.reset({ doc: event.doc, version: event.version })
          }
          return
        }
        const doc = new LiveDoc(
          { doc: event.doc, version: event.version },
          {
            send: (version, steps, client) => this.#send({ type: 'steps', file: event.file, version, steps, client }),
            since: (version) => this.#send({ type: 'since', file: event.file, version }),
            moved: (words) => this.#send({ type: 'moved', file: event.file, words }),
            here: (caret) => this.#moved({ file: event.file, ...caret }),
          },
        )
        this.#docs.set(event.file, doc)
        // the carets already in it
        for (const person of this.#people.values()) {
          this.#route(person)
        }
        const waiting = this.#opening.get(event.file) ?? []
        this.#opening.delete(event.file)
        waiting.forEach((w) => w.resolve(doc))
        return
      }
      case 'steps':
        this.#docs.get(event.file)?.receive(
          event.from,
          event.steps,
          event.clients,
          event.by.map((by) => this.#agentOf(by)),
        )
        return
      case 'behind':
        this.#docs.get(event.file)?.behind(event.version)
        return
      case 'gone':
        this.#docs.get(event.file)?.gone()
        return
      case 'refused': {
        this.#docs.get(event.file)?.refused()
        const waiting = this.#opening.get(event.file)
        if (waiting) {
          this.#opening.delete(event.file)
          waiting.forEach((w) => w.reject(new Error(event.message)))
        }
        this.#deps.onRefused?.(event.file, event.message)
        return
      }
      case 'version':
        this.#deps.onVersion?.(event.version, event.by, event.committed, event.overwrote)
        return
      case 'discarded':
        this.#deps.onDiscarded?.(event.by)
        return
      case 'joined':
        this.#joined = true
        this.#everyone(event.people)
        this.#changed()
        return
      case 'presence':
        this.#people.set(event.person.window, event.person)
        this.#route(event.person)
        this.#changed()
        return
      case 'left':
        this.#gone(event.window)
        this.#changed()
        return
    }
  }
}
