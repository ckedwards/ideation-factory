// PROTOTYPE: small UI pieces shared by the pages.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { ME, type Actor, type ClosedReason, type Idea, type IdeaStatus, type WatchLevel } from './data'
import { useStore, type Theme } from './store'
import { WATCH_LEVELS, ago, coarseState, evaluate, hasRequirements, isActive, isArchived, isClosed, watchLevel, type CoarseState } from './model'
import { matchText, rank } from './search'

export function Avatar({ userId, size = 'md' }: { userId: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const { state } = useStore()
  const u = state.users[userId]
  const src = state.avatars[userId]
  return (
    <span
      className={`avatar avatar-${size} ${src ? 'has-img' : ''} ${u?.inactive ? 'is-inactive' : ''}`}
      data-user={userId}
      title={u ? `${u.name} @${u.handle}${u.inactive ? ' · inactive' : ''}` : undefined}
    >
      {src ? <img src={src} alt="" /> : (u?.initials ?? '?')}
    </span>
  )
}

export function UserName({ userId }: { userId: string }) {
  const { state } = useStore()
  return <>{state.users[userId]?.name ?? userId}</>
}

// Shown next to anyone a site admin has marked inactive.
export function InactiveTag({ userId }: { userId: string }) {
  const { state } = useStore()
  const u = state.users[userId]
  if (!u?.inactive) return null
  return (
    <span className="tag tag-inactive" title={`Inactive since ${new Date(u.inactive.since).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}. Read only.`}>
      inactive
    </span>
  )
}

export function ActorLabel({ actor, short }: { actor: Actor; short?: boolean }) {
  const { state } = useStore()
  if (actor.kind === 'user')
    return (
      <span className="actor" title={`@${state.users[actor.userId]?.handle}`}>
        <Avatar userId={actor.userId} size="sm" />
        <span className="actor-name">{state.users[actor.userId]?.name}</span>
        <InactiveTag userId={actor.userId} />
      </span>
    )
  return (
    <span className="actor actor-bot">
      <span className="bot-mark" aria-hidden>
        🤖
      </span>
      <span className="actor-name">{actor.bot}</span>
      {actor.kind === 'userbot' ? (
        <span className="actor-behalf">
          {short ? 'for' : 'on behalf of'} <span className="actor-person">{state.users[actor.userId]?.name}</span>
          <InactiveTag userId={actor.userId} />
        </span>
      ) : (
        <span className="tag tag-bot">automated</span>
      )}
    </span>
  )
}

export function StatusPill({ status, reason, archived }: { status: IdeaStatus; reason?: ClosedReason; archived?: boolean }) {
  const cls = archived ? 'status-archived' : status === 'closed' ? `status-closed-${reason}` : `status-${status.replace(/ /g, '-')}`
  const label = archived ? 'Archived' : status === 'closed' ? `Closed · ${reason}` : status[0].toUpperCase() + status.slice(1)
  return (
    <span className={`status ${cls} status-pill`} title={archived ? `Its team is archived. It was ${status} and is now read-only.` : undefined}>
      <span className="status-dot" aria-hidden />
      {label}
    </span>
  )
}

// How an idea stands against its team's approval requirements.
export function ApprovalProgress({ idea }: { idea: Idea }) {
  const { state } = useStore()
  const team = state.teams.find((t) => t.id === idea.teamId)
  if (!team || !isActive(state, idea)) return null
  if (!hasRequirements(team.requirements))
    return (
      <span className="approvals" title="This team has no approval requirements">
        {idea.approvals.length} approval{idea.approvals.length === 1 ? '' : 's'}
      </span>
    )
  const e = evaluate(state.groups, team, idea)
  if (e.broken > 0)
    return (
      <span className="approvals is-broken" title={`${team.name}’s approval requirements name a deleted group. A maintainer or admin of ${team.name} needs to fix them before this idea can be approved.`}>
        ⚠ Requirements need fixing
      </span>
    )
  const done = e.met === e.total
  return (
    <span className={`approvals ${done ? 'is-met' : ''}`} title={e.checks.map((r) => `${r.met ? '✓' : '○'} ${r.text}${r.progress ? ` (${r.progress})` : ''}`).join('\n')}>
      {done ? '✓ Requirements met' : `${e.met} of ${e.total} requirement${e.total === 1 ? '' : 's'} met`}
    </span>
  )
}

// Your watch level for a team.
export function WatchSelect({ teamId, label = 'Notify me about' }: { teamId: string; label?: string }) {
  const { state, dispatch } = useStore()
  const team = state.teams.find((t) => t.id === teamId)
  const level = watchLevel(state, teamId)
  return (
    <label className={`watch-select ${level !== 'participating' ? 'is-on' : ''}`} title={WATCH_LEVELS.find((w) => w.id === level)!.blurb}>
      <span className="watch-select-label">{label}</span>
      <select
        value={level}
        onChange={(e) => {
          const next = e.target.value as WatchLevel
          dispatch({ type: 'setWatch', teamId, level: next })
          dispatch({ type: 'toast', text: `${team?.name}: ${WATCH_LEVELS.find((w) => w.id === next)!.blurb}` })
        }}
      >
        {WATCH_LEVELS.map((w) => (
          <option key={w.id} value={w.id}>
            {w.label}
          </option>
        ))}
      </select>
    </label>
  )
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'contrast', label: 'High contrast' },
]

export function ThemeToggle() {
  const { state, dispatch } = useStore()
  return (
    <div className="seg" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} role="radio" aria-checked={state.theme === t.id} className={state.theme === t.id ? 'on' : ''} onClick={() => dispatch({ type: 'setTheme', theme: t.id })}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// Text with the search match highlighted.
export function Highlight({ text, query }: { text: string; query?: string }) {
  // one span, so flex/grid parents don't split the text into separate items
  const hit = query ? matchText(query, text) : null
  if (!hit) return <span>{text}</span>
  return (
    <span>
      {text.slice(0, hit.start)}
      <mark className="hit">{text.slice(hit.start, hit.end)}</mark>
      {text.slice(hit.end)}
    </span>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  label,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoFocus?: boolean
  label: string
}) {
  return (
    <label className="search">
      <span className="search-icon" aria-hidden>
        ⌕
      </span>
      <input type="search" value={value} placeholder={placeholder} aria-label={label} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export function TeamChip({ teamId }: { teamId: string }) {
  const { state } = useStore()
  const t = state.teams.find((x) => x.id === teamId)
  if (t?.personal)
    return (
      <Link to="/teams/$teamId" params={{ teamId }} className="team-chip team-chip-personal" onClick={(e) => e.stopPropagation()} title="Not in any team. Private.">
        🔒 {t.personal === ME ? 'Your ideas' : `${state.users[t.personal]?.name ?? 'Someone'}’s ideas`}
      </Link>
    )
  return (
    <Link
      to="/teams/$teamId"
      params={{ teamId }}
      className={`team-chip ${t?.locked ? 'team-chip-locked' : ''}`}
      onClick={(e) => e.stopPropagation()}
      title={t?.locked ? 'Locked team: only its members can see its ideas' : undefined}
    >
      {t?.locked && '🔒 '}
      {t?.name ?? teamId}
    </Link>
  )
}

// Only one idea has a real page (experiment 1); the rest explain that.
// The demo build serves both prototypes together, so it links within the site.
export const IDEA_PAGE_URL: string = import.meta.env.VITE_IDEA_PAGE_URL ?? 'http://localhost:5199/prototype/idea'
const IDEA_PAGES: Record<string, string> = {
  'idea-142': IDEA_PAGE_URL,
  // the MVP architecture docs (Dogfood team), read from the repository's mvp/ folder
  'idea-mvp': `${IDEA_PAGE_URL}?idea=mvp`,
}

export function IdeaLink({ idea, children, className }: { idea: Idea; children: ReactNode; className?: string }) {
  const { dispatch } = useStore()
  // opening an idea marks its notifications read
  const read = () => dispatch({ type: 'markIdeasRead', ideaIds: [idea.id], read: true })
  // ideas that have a real page on the idea page prototype (experiment 1)
  const page = IDEA_PAGES[idea.id]
  if (page)
    return (
      <a className={className} href={page} onClick={read} title={import.meta.env.VITE_IDEA_PAGE_URL ? 'Opens the idea page prototype' : 'Opens experiment 1’s idea page (run it on port 5199)'}>
        {children}
      </a>
    )
  return (
    <a
      className={className}
      href="#"
      onClick={(e) => {
        e.preventDefault()
        read()
        dispatch({ type: 'toast', text: `Only “Offline-first sync for the field app” and “Ideation Factory MVP architecture” have an idea page in this prototype (experiment 1).` })
      }}
    >
      {children}
    </a>
  )
}

export function ReviewerStack({ idea, hideGroup }: { idea: Idea; hideGroup?: string }) {
  const reviewers = idea.reviewers.filter((r) => !(r.kind === 'group' && r.groupId === hideGroup))
  if (idea.reviewers.length === 0) return <span className="muted">No reviewers yet</span>
  return (
    <span className="reviewer-stack">
      {reviewers.map((r) =>
        r.kind === 'user' ? (
          <Avatar key={r.userId} userId={r.userId} size="sm" />
        ) : (
          <GroupTag key={r.groupId} groupId={r.groupId} />
        ),
      )}
    </span>
  )
}

// What a row can leave out because the page already says it: the team (on that
// team's page), the author (lists of your own ideas), or a group (on that
// group's page, it needn't be listed among the reviewers).
export type RowHide = { team?: boolean; author?: boolean; groupId?: string }

export function IdeaRow({ idea, query, extra, hide = {} }: { idea: Idea; query?: string; extra?: ReactNode; hide?: RowHide }) {
  const { state } = useStore()
  return (
    <article className="idea-row">
      <div className="idea-row-main">
        <IdeaLink idea={idea} className="idea-row-title">
          <Highlight text={idea.title} query={query} />
        </IdeaLink>
        <p className="idea-row-desc">
          <Highlight text={idea.description} query={query} />
        </p>
        <div className="idea-row-meta">
          {!hide.team && <TeamChip teamId={idea.teamId} />}
          {!hide.author && (
            <span className="actor">
              <Avatar userId={idea.authorId} size="sm" />
              <Highlight text={state.users[idea.authorId]?.name ?? ''} query={query} />
              <InactiveTag userId={idea.authorId} />
            </span>
          )}
          <span className="muted">
            v{idea.version}
            {!isClosed(state, idea) && <> · updated {ago(idea.updatedAt)}</>}
          </span>
          {!hide.team && state.teams.find((t) => t.id === idea.teamId)?.personal && (
            <span className="tag tag-private" title="Only the author and people they ask to review can see this">
              🔒 Private
            </span>
          )}
          {extra}
        </div>
      </div>
      <div className="idea-row-side">
        <StatusPill status={idea.status} reason={idea.closedReason} archived={isArchived(state, idea)} />
        {isArchived(state, idea) ? (
          <span className="idea-row-threads">Team archived</span>
        ) : isClosed(state, idea) ? (
          <span className="idea-row-threads">Closed {ago(idea.updatedAt)}</span>
        ) : (
          <>
            <ApprovalProgress idea={idea} />
            <span className="idea-row-threads" title="Open comment threads">
              {idea.openThreads > 0 ? `${idea.openThreads} open thread${idea.openThreads === 1 ? '' : 's'}` : 'No open threads'}
            </span>
          </>
        )}
        <ReviewerStack idea={idea} hideGroup={hide.groupId} />
      </div>
    </article>
  )
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

// A small modal: Esc or the backdrop closes it, focus starts inside.
export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLElement>('input, textarea, button')?.focus()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      prev?.focus()
    }
  }, [])
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <header className="dialog-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        <footer className="dialog-foot">{footer}</footer>
      </div>
    </div>,
    document.body,
  )
}

export function Toast() {
  const { state } = useStore()
  if (!state.toast) return null
  return (
    <div className="toast" role="status">
      {state.toast}
    </div>
  )
}

// One URL search param as page state, e.g. ?q= or ?tab=. The default value
// is left out of the URL.
export function useParam<T extends string>(key: string, fallback: T): [T, (v: T | '') => void] {
  const search = useSearch({ strict: false }) as Record<string, unknown>
  const navigate = useNavigate()
  const raw = search[key]
  const value = (typeof raw === 'string' || typeof raw === 'number' ? String(raw) : fallback) as T
  // changing anything but the page sends you back to page 1
  const set = (v: T | '') =>
    navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        [key]: v === fallback || v === '' ? undefined : key === 'page' ? Number(v) : v, // page stays a plain number in the URL
        ...(key === 'page' ? {} : { page: undefined }),
      }),
      replace: true,
    } as never)
  return [value, set]
}

export const fmt = (n: number) => n.toLocaleString('en')

// ---------- pagination ----------

export const PAGE_SIZE = 25

// One page of `items`, with the page number in the URL (?page=).
export function usePaged<T>(items: T[], size = PAGE_SIZE) {
  const [raw, setPage] = useParam<string>('page', '1')
  const pages = Math.max(1, Math.ceil(items.length / size))
  const page = Math.min(Math.max(1, Number(raw) || 1), pages)
  const slice = items.slice((page - 1) * size, page * size)
  const pager =
    items.length > size ? (
      <nav className="pager" aria-label="Pages">
        <span className="pager-range">
          {fmt((page - 1) * size + 1)}–{fmt(Math.min(page * size, items.length))} of {fmt(items.length)}
        </span>
        <button disabled={page <= 1} onClick={() => setPage(String(page - 1))}>
          ← Previous
        </button>
        <span className="pager-pages">
          Page {fmt(page)} of {fmt(pages)}
        </span>
        <button disabled={page >= pages} onClick={() => setPage(String(page + 1))}>
          Next →
        </button>
      </nav>
    ) : null
  return { slice, pager, total: items.length }
}

// ---------- type-ahead pickers ----------

export type Option = { id: string; label: string; sub?: string; avatar?: string }

// Pick one thing out of thousands: type to search, results ranked and capped.
// `pinned` options (e.g. "You") show before you type.
export function Combobox({
  value,
  onChange,
  search,
  display,
  placeholder,
  label,
  pinned = [],
  anyLabel,
}: {
  value: string
  onChange: (id: string) => void
  search: (q: string) => Option[]
  display: (id: string) => Option | undefined
  placeholder: string
  label: string
  pinned?: Option[]
  anyLabel: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const results = useMemo(() => (q.trim() ? search(q).slice(0, 8) : pinned), [q, search, pinned])
  useEffect(() => {
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [])
  const choose = (id: string) => {
    onChange(id)
    setQ('')
    setOpen(false)
  }
  const current = value ? display(value) : undefined

  return (
    <div className="combo" ref={box}>
      {current ? (
        <span className="combo-value">
          {current.avatar && <Avatar userId={current.avatar} size="sm" />}
          <span className="combo-value-label">{current.label}</span>
          <button className="combo-clear" aria-label={`Clear ${label}`} onClick={() => choose('')}>
            ✕
          </button>
        </span>
      ) : (
        <input
          className="combo-input"
          value={q}
          placeholder={anyLabel}
          aria-label={label}
          role="combobox"
          aria-expanded={open}
          onFocus={() => setOpen(true)}
          onChange={(e) => (setQ(e.target.value), setOpen(true), setHi(0))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setHi((h) => Math.min(h + 1, results.length - 1)))
            if (e.key === 'ArrowUp') (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)))
            if (e.key === 'Enter' && results[hi]) (e.preventDefault(), choose(results[hi].id))
            if (e.key === 'Escape') setOpen(false)
          }}
        />
      )}
      {open && !current && results.length > 0 && (
        <ul className="combo-list" role="listbox" aria-label={label}>
          {results.map((o, i) => (
            <li key={o.id}>
              <button role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''} onMouseEnter={() => setHi(i)} onClick={() => choose(o.id)}>
                {o.avatar && <Avatar userId={o.avatar} size="sm" />}
                <span className="combo-opt">
                  <Highlight text={o.label} query={q} />
                  {o.sub && <span className="combo-sub">{o.sub}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !current && q.trim() && results.length === 0 && <div className="combo-list combo-empty">No matches for “{q.trim()}”. {placeholder}</div>}
    </div>
  )
}

// Search people by name or @handle (names repeat at this scale; handles don't).
// activeOnly: for adding people or asking for reviews (inactive people are read-only).
export function usePeopleSearch(exclude: string[] = [], activeOnly = false) {
  const { state } = useStore()
  const people = useMemo(() => Object.values(state.users), [state.users])
  return useMemo(() => {
    const skip = new Set(exclude)
    const teamOf = new Map<string, string>()
    for (const t of state.teams) for (const m of t.members) if (!teamOf.has(m)) teamOf.set(m, t.name)
    const option = (id: string): Option | undefined => {
      const u = state.users[id]
      return u ? { id, label: u.name, sub: `@${u.handle}${u.inactive ? ' · inactive' : teamOf.get(id) ? ` · ${teamOf.get(id)}` : ''}`, avatar: id } : undefined
    }
    const search = (q: string) =>
      rank(people.filter((u) => !skip.has(u.id) && !(activeOnly && u.inactive)), q.replace(/^@/, ''), (u) => [
        { name: 'name', text: u.name, weight: 0 },
        { name: 'handle', text: u.handle, weight: 1 },
      ]).map((r) => option(r.item.id)!)
    return { search, option }
  }, [people, state.teams, exclude.join(), activeOnly])
}

export function useTeamSearch() {
  const { state } = useStore()
  return useMemo(() => {
    const option = (id: string): Option | undefined => {
      const t = state.teams.find((x) => x.id === id)
      return t ? { id, label: `${t.locked ? '🔒 ' : ''}${t.name}`, sub: `${t.locked ? 'Locked · ' : ''}${fmt(t.members.length)} members` } : undefined
    }
    // personal spaces ("Your ideas") are never offered as teams; locked teams are
    const search = (q: string) => rank(state.teams.filter((t) => !t.personal), q, (t) => [{ name: 'name', text: t.name, weight: 0 }]).map((r) => option(r.item.id)!)
    // archived teams stay findable (their ideas are still readable)
    return { search, option }
  }, [state.teams])
}

export function useGroupSearch(exclude: string[] = []) {
  const { state } = useStore()
  return useMemo(() => {
    const skip = new Set(exclude)
    const option = (id: string): Option | undefined => {
      const g = state.groups.find((x) => x.id === id)
      return g ? { id, label: g.name, sub: `${fmt(g.members.length)} people` } : undefined
    }
    const search = (q: string) =>
      rank(state.groups.filter((g) => !skip.has(g.id) && !g.deletedAt), q, (g) => [{ name: 'name', text: g.name, weight: 0 }]).map((r) => option(r.item.id)!)
    return { search, option }
  }, [state.groups, exclude.join()])
}

// A few avatars and a count, instead of every name.
export function AvatarStack({ ids, max = 6 }: { ids: string[]; max?: number }) {
  return (
    <span className="avatar-stack">
      {ids.slice(0, max).map((m) => (
        <Avatar key={m} userId={m} size="sm" />
      ))}
      {ids.length > max && <span className="avatar-more">+{fmt(ids.length - max)}</span>}
    </span>
  )
}

// Change several URL params in one navigation (e.g. "Clear filters"); also back to page 1.
export function useSetParams() {
  const navigate = useNavigate()
  return (patch: Record<string, string | undefined>) =>
    navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => {
        const next: Record<string, unknown> = { ...prev, page: undefined }
        for (const [k, v] of Object.entries(patch)) next[k] = v === '' ? undefined : v
        return next
      },
      replace: true,
    } as never)
}

// A group as a small tag; deleted groups are struck through and flagged.
export function GroupTag({ groupId }: { groupId: string }) {
  const { state } = useStore()
  const g = state.groups.find((x) => x.id === groupId)
  if (!g || g.deletedAt)
    return (
      <span className="tag group-tag is-deleted" title="This group was deleted">
        {g?.name ?? groupId} · deleted
      </span>
    )
  return (
    <Link to="/groups/$groupId" params={{ groupId }} className="tag group-tag" onClick={(e) => e.stopPropagation()}>
      {g.name}
    </Link>
  )
}

// ---------- site admin call-outs ----------
// Anything a person can do only because they're a site admin is marked with
// the same shield and color, so it never blends in with their normal access.

export function AdminMark({ label = 'Site admin' }: { label?: string }) {
  return (
    <span className="admin-mark" title="You see this only because you’re a site admin">
      <span aria-hidden>🛡</span> {label}
    </span>
  )
}

export function AdminCallout({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="admin-callout" role="note">
      <div className="admin-callout-title">
        <span aria-hidden>🛡</span> {title}
      </div>
      {children && <div className="admin-callout-body">{children}</div>}
    </div>
  )
}

// ---------- idea state (notification rows) ----------

type StateKey = 'draft' | 'review' | 'met' | 'accepted' | 'rejected' | 'archived'
const stateKey = (c: CoarseState): StateKey => (c.kind === 'draft' ? 'draft' : c.kind === 'review' ? (c.met ? 'met' : 'review') : c.how)
const STATE_LABEL: Record<StateKey, string> = {
  draft: 'Draft',
  review: 'In review',
  met: 'Reqs met',
  accepted: 'Closed',
  rejected: 'Closed',
  archived: 'Closed',
}
const STATE_SHAPE: Record<StateKey, ReactNode> = {
  // dashed ring: not out yet
  draft: <circle cx="8" cy="8" r="5.5" strokeDasharray="2.2 2.2" />,
  // ring, half filled: under way
  review: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" stroke="none" />
    </>
  ),
  // ring with a check: requirements met
  met: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.5 8.25l1.75 1.75 3.25-3.5" />
    </>
  ),
  // closed states are solid
  accepted: (
    <>
      <circle cx="8" cy="8" r="6.5" fill="currentColor" stroke="none" />
      <path d="M5.25 8.25l1.9 1.9 3.6-3.9" stroke="var(--surface)" strokeWidth="1.75" />
    </>
  ),
  rejected: (
    <>
      <circle cx="8" cy="8" r="6.5" fill="currentColor" stroke="none" />
      <path d="M5.75 5.75l4.5 4.5 M10.25 5.75l-4.5 4.5" stroke="var(--surface)" strokeWidth="1.75" />
    </>
  ),
  archived: (
    <>
      <rect x="2" y="3" width="12" height="3.5" rx="0.75" fill="currentColor" stroke="none" />
      <path d="M3 7v6h10V7 M6.5 9.5h3" />
    </>
  ),
}

// The idea's coarse state as an icon (and, unless compact, a short label).
// Hovering (after a delay) or focusing it shows the details in a tooltip.
export function IdeaState({ idea, compact }: { idea: Idea; compact?: boolean }) {
  const { state } = useStore()
  const c = coarseState(state, idea)
  const key = stateKey(c)
  return (
    <Tooltip className={`idea-state state-${key}`} label={`State: ${STATE_LABEL[key]}`} tip={() => <StateDetails idea={idea} c={c} k={key} />}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {STATE_SHAPE[key]}
      </svg>
      {!compact && <span className="idea-state-label">{STATE_LABEL[key]}</span>}
    </Tooltip>
  )
}

function StateDetails({ idea, c, k }: { idea: Idea; c: CoarseState; k: StateKey }) {
  const { state } = useStore()
  const team = state.teams.find((t) => t.id === idea.teamId)
  const names = (ids: string[]) => {
    const n = ids.map((id) => state.users[id]?.name ?? id)
    return n.length > 3 ? `${n.slice(0, 3).join(', ')} and ${n.length - 3} more` : n.join(', ')
  }
  const people = idea.reviewers.filter((r) => r.kind === 'user').length
  const groups = idea.reviewers.length - people
  const reviewers = [people && `${people} ${people === 1 ? 'person' : 'people'}`, groups && `${groups} group${groups === 1 ? '' : 's'}`].filter(Boolean).join(' and ')
  const head =
    c.kind === 'draft'
      ? 'Draft'
      : c.kind === 'closed'
        ? c.how === 'archived'
          ? 'Closed · team archived'
          : `Closed as ${c.how}`
        : c.noRules
          ? 'In review · no requirements'
          : c.e && c.e.broken > 0
            ? 'In review · requirements need fixing'
            : `In review · ${c.e!.met} of ${c.e!.total} requirement${c.e!.total === 1 ? '' : 's'} met`
  return (
    <>
      <div className={`tip-head state-${k}`}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {STATE_SHAPE[k]}
        </svg>
        <span>{head}</span>
      </div>
      <dl className="tip-facts">
        <dt>Status</dt>
        <dd>
          <StatusPill status={idea.status} reason={idea.closedReason} archived={isArchived(state, idea)} />
        </dd>
        {c.kind === 'review' && c.e && (
          <>
            <dt>Requirements</dt>
            <dd>
              <ul className="tip-rules">
                {c.e.checks.map((r) => (
                  <li key={r.key} className={r.broken ? 'is-broken' : r.met ? 'is-met' : 'is-open'}>
                    <span className="tip-mark" aria-hidden>
                      {r.broken ? '⚠' : r.met ? '✓' : '○'}
                    </span>
                    <span>
                      {r.text}
                      {r.progress && <span className="tip-muted"> ({r.progress})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {c.kind === 'review' && c.noRules && (
          <>
            <dt>Requirements</dt>
            <dd>None, so it can be closed as accepted any time.</dd>
          </>
        )}
        {c.kind !== 'draft' && (
          <>
            <dt>Approvals</dt>
            <dd>{idea.approvals.length ? names(idea.approvals) : <span className="tip-muted">None yet</span>}</dd>
          </>
        )}
        <dt>Reviewers</dt>
        <dd>{reviewers || <span className="tip-muted">None yet</span>}</dd>
        <dt>Team</dt>
        <dd>{team?.personal ? '🔒 Your ideas' : `${team?.locked ? '🔒 ' : ''}${team?.name}`}</dd>
        <dt>{c.kind === 'closed' ? 'Closed' : 'Updated'}</dt>
        <dd>
          {ago(idea.updatedAt)} · v{idea.version}
        </dd>
      </dl>
      {c.kind === 'closed' && c.how === 'archived' && <p className="tip-note">Its team is archived, so it’s read-only and counts as closed.</p>}
      {c.kind === 'draft' && <p className="tip-note">Not out for review yet.</p>}
    </>
  )
}

// A real tooltip, in a portal (rows clip overflow):
// - opens after a delay on hover; once one has been open, the next opens at
//   once (moving down a list), until the pointer rests off them for a moment
// - opens straight away on keyboard focus
// - closes as soon as the pointer leaves, and on click, scroll or Esc
// - a themed card (same surface as the page) above the anchor with an arrow
//   (below if there's no room); it never takes the pointer, so it doesn't get
//   in the way
const TIP_DELAY = 600
const TIP_SKIP = 400
let tipWarmUntil = 0
let tipSeq = 0

export function Tooltip({ className, label, tip, children }: { className?: string; label: string; tip: () => ReactNode; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; arrow: number; below: boolean } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const [id] = useState(() => `tip-${++tipSeq}`)
  const show = (delay: number) => {
    window.clearTimeout(timer.current)
    if (delay <= 0 || Date.now() < tipWarmUntil) setOpen(true)
    else timer.current = window.setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setOpen((was) => {
      if (was) tipWarmUntil = Date.now() + TIP_SKIP
      return false
    })
  }
  useLayoutEffect(() => {
    if (!open || !anchor.current || !box.current) return setPos(null)
    const a = anchor.current.getBoundingClientRect()
    const b = box.current.getBoundingClientRect()
    const gap = 8
    const below = a.top - gap - b.height < 8
    const top = below ? a.bottom + gap : a.top - gap - b.height
    const left = Math.max(8, Math.min(a.left + a.width / 2 - b.width / 2, innerWidth - b.width - 8))
    setPos({ top, left, below, arrow: a.left + a.width / 2 - left })
  }, [open])
  useEffect(() => {
    if (!open) return
    const off = () => hide()
    addEventListener('scroll', off, true)
    addEventListener('resize', off)
    return () => {
      removeEventListener('scroll', off, true)
      removeEventListener('resize', off)
    }
  }, [open])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <>
      <span
        ref={anchor}
        className={className}
        tabIndex={0}
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => show(TIP_DELAY)}
        onMouseLeave={hide}
        onMouseDown={hide}
        onFocus={(e) => e.currentTarget.matches(':focus-visible') && show(0)}
        onBlur={hide}
        onKeyDown={(e) => e.key === 'Escape' && hide()}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={box}
            id={id}
            className={`tooltip ${pos?.below ? 'is-below' : ''}`}
            role="tooltip"
            style={pos ? { top: pos.top, left: pos.left, ['--arrow' as string]: `${pos.arrow}px` } : { visibility: 'hidden', top: 0, left: 0 }}
          >
            {tip()}
          </div>,
          document.body,
        )}
    </>
  )
}
