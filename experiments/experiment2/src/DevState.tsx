// PROTOTYPE: dev-only "state" button that shows the in-memory state, so you
// can see what each action changed. Not part of the design.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ME } from './data'
import { useStore } from './store'

export function DevState() {
  const { state, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  // dev builds, and the shared demo build (VITE_DEMO), where these switches are how people explore
  if (!import.meta.env.DEV && !import.meta.env.VITE_DEMO) return null

  const summary = {
    me: { ...state.users[ME], hasPicture: !!state.avatars[ME] },
    memberOf: state.teams.filter((t) => t.members.includes(ME)).map((t) => t.name),
    watching: state.watching, // per team; others are 'participating'
    groups: state.groups.map((g) => `${g.name} (${g.members.join(', ')})`),
    unread: state.notifications.filter((n) => !n.read).map((n) => n.id),
    subscribed: state.subscribed,
    muted: state.muted,
    tokens: state.tokens.map((t) => `${t.name} · ${t.purpose}${t.bot ? ` · ${t.bot}` : ''}`),
    siteAdmin: state.siteAdmin,
    deployment: state.deployment,
    passkeys: state.passkeys.map((p) => p.name),
    theme: state.theme,
  }

  return (
    <>
      {open && <pre className="proto-state">{JSON.stringify(summary, null, 2)}</pre>}
      <div className="proto-dev">
        <label className="proto-state-btn" title="Prototype only: act as a site admin, who is an admin of every team and group">
          <input type="checkbox" checked={state.siteAdmin} onChange={(e) => dispatch({ type: 'setSiteAdmin', on: e.target.checked })} /> site admin
        </label>
        <Link to="/signup" className="proto-state-btn" title="Prototype only: preview the sign-in and sign-up page">
          sign-up
        </Link>
        <button className="proto-state-btn" onClick={() => setOpen((o) => !o)} title="Show the prototype's in-memory state">
          {open ? 'hide state' : 'state'}
        </button>
      </div>
    </>
  )
}
