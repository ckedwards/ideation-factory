// PROTOTYPE: in-memory state. Nothing persists except the theme choice.
import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react'
import {
  deployment,
  initialActivity,
  initialComments,
  initialStatus,
  initialVersions,
  me,
  NOW,
  type Activity,
  type Anchor,
  type Comment,
  type ExternalImages,
  type IdeaStatus,
  type Version,
} from './data'

export type Theme = 'system' | 'light' | 'dark' | 'contrast'

type State = {
  versions: Version[]
  comments: Comment[]
  status: IdeaStatus
  activity: Activity[]
  theme: Theme
  externalImages: ExternalImages // from the deployment settings (dev control can flip it)
  subscribed: boolean // notifications for this idea (on by default: Riley wrote it)
  clock: number // fake clock so new items sort after canned ones
}

type Action =
  | { type: 'addComment'; file: string; version: number; anchor: Anchor; body: string; replacement?: string }
  | { type: 'reply'; id: string; body: string }
  | { type: 'toggleResolved'; id: string }
  | { type: 'acceptSuggestion'; id: string }
  | { type: 'rejectSuggestion'; id: string }
  | { type: 'setStatus'; status: IdeaStatus }
  | { type: 'setTheme'; theme: Theme }
  | { type: 'setSubscribed'; on: boolean }
  | { type: 'setExternalImages'; mode: ExternalImages }

const meActor = { kind: 'user', userId: me.id } as const

function tick(s: State) {
  const clock = s.clock + 60_000
  return { clock, at: new Date(clock).toISOString() }
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'addComment': {
      const { clock, at } = tick(s)
      const c: Comment = {
        id: `new-${clock}`,
        file: a.file,
        version: a.version,
        anchor: a.anchor,
        author: meActor,
        body: a.body,
        at,
        status: 'unresolved',
        replies: [],
        suggestion: a.replacement !== undefined ? { replacement: a.replacement, state: 'open' } : undefined,
      }
      return { ...s, clock, comments: [...s.comments, c] }
    }
    case 'reply': {
      const { clock, at } = tick(s)
      return {
        ...s,
        clock,
        comments: s.comments.map((c) =>
          c.id === a.id ? { ...c, replies: [...c.replies, { id: `r-${clock}`, author: meActor, body: a.body, at }] } : c,
        ),
      }
    }
    case 'toggleResolved':
      return {
        ...s,
        comments: s.comments.map((c) =>
          c.id === a.id ? { ...c, status: c.status === 'resolved' ? 'unresolved' : 'resolved' } : c,
        ),
      }
    case 'rejectSuggestion':
      return {
        ...s,
        comments: s.comments.map((c) =>
          c.id === a.id && c.suggestion ? { ...c, status: 'resolved', suggestion: { ...c.suggestion, state: 'rejected' } } : c,
        ),
      }
    case 'acceptSuggestion': {
      // Accepting creates a new version (architecture.md: suggested edits).
      const c = s.comments.find((x) => x.id === a.id)
      if (!c?.suggestion || c.anchor.type !== 'selection') return s
      const latest = s.versions[s.versions.length - 1]
      const src = latest.files[c.file]
      if (src === undefined || !src.includes(c.anchor.quote)) return s
      const { clock, at } = tick(s)
      const next: Version = {
        n: latest.n + 1,
        author: meActor,
        message: 'Accepted a suggested edit',
        at,
        files: { ...latest.files, [c.file]: src.replace(c.anchor.quote, c.suggestion.replacement) },
      }
      return {
        ...s,
        clock,
        versions: [...s.versions, next],
        comments: s.comments.map((x) =>
          x.id === c.id
            ? {
                ...x,
                status: 'resolved',
                anchor: { ...c.anchor, quote: c.suggestion!.replacement },
                suggestion: { ...c.suggestion!, state: 'accepted' },
              }
            : x,
        ),
      }
    }
    case 'setStatus': {
      if (a.status === s.status) return s
      const { clock, at } = tick(s)
      const label = a.status[0].toUpperCase() + a.status.slice(1)
      return {
        ...s,
        clock,
        status: a.status,
        activity: [...s.activity, { id: `a-${clock}`, at, actor: meActor, kind: 'status', text: `changed the status to ${label}` }],
      }
    }
    case 'setExternalImages':
      return { ...s, externalImages: a.mode }
    case 'setSubscribed':
      return { ...s, subscribed: a.on }
    case 'setTheme':
      return { ...s, theme: a.theme }
  }
}

function loadTheme(): Theme {
  try {
    return (localStorage.getItem('ideaf-proto-theme') as Theme) || 'system'
  } catch {
    return 'system'
  }
}

const Ctx = createContext<{ state: State; dispatch: (a: Action) => void } | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    versions: initialVersions,
    comments: initialComments,
    status: initialStatus,
    activity: initialActivity,
    theme: loadTheme(),
    subscribed: true,
    externalImages: deployment.externalImages,
    clock: NOW,
  }))

  useEffect(() => {
    const root = document.documentElement
    if (state.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', state.theme)
    try {
      localStorage.setItem('ideaf-proto-theme', state.theme)
    } catch {
      /* private mode */
    }
  }, [state.theme])

  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>
}

export function useStore() {
  const v = useContext(Ctx)
  if (!v) throw new Error('StoreProvider missing')
  return v
}
