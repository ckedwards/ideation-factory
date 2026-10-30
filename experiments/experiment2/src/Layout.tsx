// PROTOTYPE: the site shell. Left navigation with a global quick search,
// your teams and watched teams, and you; pages render on the right.
import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { ME, type WatchLevel } from './data'
import { useStore } from './store'
import { isOpen, myPersonalTeam, myTeams, threads, visibleIdeas, watchLevel } from './model'
import { rank } from './search'
import { AdminMark, Avatar, Highlight, IdeaLink, StatusPill, ThemeToggle, Toast } from './ui'
import { DevState } from './DevState'

export function Layout() {
  const { state } = useStore()
  // the sign-in page stands alone, without the site's navigation
  const path = useRouterState({ select: (r) => r.location.pathname })
  if (path === '/signup')
    return (
      <>
        <Outlet />
        <Toast />
        <DevState />
      </>
    )
  return <Site />
}

function Site() {
  const { state } = useStore()
  const unread = threads(state).filter((t) => t.unread > 0 && !t.done).length
  const teams = myTeams(state)
  const personal = myPersonalTeam(state)
  const watchedOnly = state.teams.filter((t) => watchLevel(state, t.id) !== 'participating' && !t.members.includes(ME))

  return (
    <div className="site">
      <aside className="nav">
        <Link to="/" className="nav-brand">
          <span className="nav-logo" aria-hidden>
            ✳
          </span>{' '}
          Ideation Factory
        </Link>

        <QuickSearch />

        <nav className="nav-main" aria-label="Main">
          <Link to="/" activeOptions={{ exact: true }} activeProps={{ className: 'on' }}>
            Home
          </Link>
          <Link to="/notifications" activeProps={{ className: 'on' }}>
            Notifications {unread > 0 && <span className="nav-count">{unread > 99 ? '99+' : unread}</span>}
          </Link>
          <Link to="/ideas" activeProps={{ className: 'on' }}>
            Ideas
          </Link>
          {personal && (
            <Link to="/teams/$teamId" params={{ teamId: personal.id }} activeProps={{ className: 'on' }}>
              🔒 Your ideas <span className="nav-sub-count">{state.ideas.filter((i) => i.teamId === personal.id && isOpen(state, i)).length}</span>
            </Link>
          )}
          <Link to="/teams" activeOptions={{ exact: true }} activeProps={{ className: 'on' }}>
            Teams
          </Link>
          <Link to="/groups" activeProps={{ className: 'on' }}>
            Groups
          </Link>
          {state.siteAdmin && (
            <Link to="/admin" className="via-admin" activeProps={{ className: 'via-admin on' }}>
              Site admin
            </Link>
          )}
        </nav>

        <div className="nav-section">
          <div className="nav-section-head">Your teams</div>
          {teams.slice(0, 6).map((t) => (
            <Link key={t.id} to="/teams/$teamId" params={{ teamId: t.id }} activeProps={{ className: 'on' }} className="nav-team">
              {t.locked && '🔒 '}
              {t.name}
              <WatchMark level={watchLevel(state, t.id)} />
            </Link>
          ))}
          {teams.length > 6 && (
            <Link to="/teams" search={{ show: 'mine' } as never} className="nav-team nav-more">
              {teams.length - 6} more…
            </Link>
          )}
          {teams.length === 0 && <span className="muted nav-empty">None yet</span>}
        </div>

        {watchedOnly.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-head">Watching</div>
            {watchedOnly.slice(0, 5).map((t) => (
              <Link key={t.id} to="/teams/$teamId" params={{ teamId: t.id }} activeProps={{ className: 'on' }} className="nav-team">
                {t.name}
                <WatchMark level={watchLevel(state, t.id)} />
              </Link>
            ))}
            {watchedOnly.length > 5 && (
              <Link to="/teams" search={{ show: 'watching' } as never} className="nav-team nav-more">
                {watchedOnly.length - 5} more…
              </Link>
            )}
          </div>
        )}

        <div className="nav-foot">
          <Link to="/settings" className="nav-me" activeProps={{ className: 'nav-me on' }}>
            <Avatar userId={ME} />
            <span>
              <span className="nav-me-name">{state.users[ME].name}</span>
              <span className="nav-me-sub">{state.siteAdmin ? <AdminMark /> : 'Settings'}</span>
            </span>
          </Link>
          <ThemeToggle />
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
      <Toast />
      <DevState />
    </div>
  )
}

// Global quick search: ideas, teams and groups as you type. "/" focuses it,
// Enter opens the full idea search.
function QuickSearch() {
  const { state } = useStore()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !t.closest('input, textarea, select, [contenteditable]')) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('keydown', key)
    document.addEventListener('mousedown', down)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('mousedown', down)
    }
  }, [])

  const ideaHits = rank(visibleIdeas(state), q, (i) => [
    { name: 'title', text: i.title, weight: 0 },
    { name: 'description', text: i.description, weight: 3 },
  ]).slice(0, 5)
  const teamHits = rank(state.teams, q, (t) => [
    { name: 'name', text: t.name, weight: 0 },
    { name: 'description', text: t.description, weight: 3 },
  ]).slice(0, 3)
  const groupHits = rank(state.groups.filter((g) => !g.deletedAt), q, (g) => [{ name: 'name', text: g.name, weight: 0 }]).slice(0, 3)
  const any = ideaHits.length + teamHits.length + groupHits.length > 0
  const close = () => {
    setOpen(false)
    setQ('')
  }

  return (
    <div className="quick" ref={box}>
      <label className="search">
        <span className="search-icon" aria-hidden>
          ⌕
        </span>
        <input
          ref={input}
          type="search"
          value={q}
          placeholder="Search ideas, teams, groups"
          aria-label="Search ideas, teams and groups"
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (close(), input.current?.blur())
            if (e.key === 'Enter' && q.trim()) {
              navigate({ to: '/ideas', search: { q: q.trim() } } as never)
              close()
            }
          }}
        />
        <kbd className="search-kbd">/</kbd>
      </label>
      {open && q.trim() && (
        <div className="quick-panel" role="listbox" aria-label="Search results">
          {!any && <div className="quick-empty">Nothing matches “{q.trim()}”.</div>}
          {ideaHits.length > 0 && <div className="quick-head">Ideas</div>}
          {ideaHits.map(({ item }) => (
            <IdeaLink key={item.id} idea={item} className="quick-item">
              <span className="quick-title">
                <Highlight text={item.title} query={q} />
              </span>
              <StatusPill status={item.status} reason={item.closedReason} />
            </IdeaLink>
          ))}
          {teamHits.length > 0 && <div className="quick-head">Teams</div>}
          {teamHits.map(({ item }) => (
            <Link key={item.id} to="/teams/$teamId" params={{ teamId: item.id }} className="quick-item" onClick={close}>
              <span className="quick-title">
                <Highlight text={item.name} query={q} />
              </span>
              <span className="muted">{item.members.length} members</span>
            </Link>
          ))}
          {groupHits.length > 0 && <div className="quick-head">Groups</div>}
          {groupHits.map(({ item }) => (
            <Link key={item.id} to="/groups/$groupId" params={{ groupId: item.id }} className="quick-item" onClick={close}>
              <span className="quick-title">
                <Highlight text={item.name} query={q} />
              </span>
              <span className="muted">{item.members.length} people</span>
            </Link>
          ))}
          <Link to="/ideas" search={{ q: q.trim() } as never} className="quick-all" onClick={close}>
            Search all ideas for “{q.trim()}” ↵
          </Link>
        </div>
      )}
    </div>
  )
}

function WatchMark({ level }: { level: WatchLevel }) {
  if (level === 'participating') return null
  return (
    <span className="nav-watch" title={level === 'all' ? 'Watching all ideas' : 'Watching active ideas'}>
      {level === 'all' ? 'All' : 'Active'}
    </span>
  )
}
