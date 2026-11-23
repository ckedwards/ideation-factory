// The draft's live socket, as the page uses it (/api/ideas/{idea}/draft/live; the server's
// draft-live.ts): open while the draft is being edited, one for every file the page has open (the
// focus view has them all). Each file is a live document (ui's editor/live.ts), which the page
// editor attaches to; this carries their steps both ways.
//
// - **Dropped,** every file goes offline and keeps its typing; it connects again (waiting longer
//   each time, up to half a minute, or once the browser says it's back online), opens its files
//   again and each catches up from its count. The browser going offline closes it at once.
// - **Edit access gone** (4403), or the idea (4404): every file closes, and the page is told.
import { DRAFT_LIVE_CLOSE, DraftLiveEvent } from '@ideaf/api'
import { LiveDoc } from '@ideaf/ui/editor/live'

export interface DraftLiveDeps {
  /** A WebSocket to a path on this site. */
  open: (path: string) => WebSocket
  /** The session's token, fresh. */
  token: () => Promise<string>
  /** A version was made: committed, or around the draft. */
  onVersion?: (version: number) => void
  /** Edit access is gone, or the idea. */
  onClosed?: (why: 'forbidden' | 'gone') => void
  /** Typing in a file was refused, and why. */
  onRefused?: (file: string, message: string) => void
  /** How often the token is sent again. */
  tokenEveryMs?: number
}

export class DraftLive {
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

  constructor(idea: string, deps: DraftLiveDeps) {
    this.#idea = idea
    this.#deps = deps
    this.#connect()
    this.#refresh = setInterval(() => void this.#sendToken(), deps.tokenEveryMs ?? 30_000)
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

  stop(): void {
    this.#stopped = true
    window.removeEventListener('offline', this.#offline)
    window.removeEventListener('online', this.#online)
    clearInterval(this.#refresh)
    clearTimeout(this.#retryTimer)
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
    ws.send(JSON.stringify({ type: 'token', token: await this.#deps.token() }))
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
          },
        )
        this.#docs.set(event.file, doc)
        const waiting = this.#opening.get(event.file) ?? []
        this.#opening.delete(event.file)
        waiting.forEach((w) => w.resolve(doc))
        return
      }
      case 'steps':
        this.#docs.get(event.file)?.receive(event.from, event.steps, event.clients)
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
        this.#deps.onVersion?.(event.version)
        return
    }
  }
}
