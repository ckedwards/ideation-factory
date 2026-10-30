// PROTOTYPE: dev-only "state" button that shows the in-memory state, so you
// can see what each action changed. Not part of the design.
import { useState } from 'react'
import { useStore } from './store'
import { useIdeaSearch } from './lib'
import type { ExternalImages } from './data'

export function DevState() {
  const [search] = useIdeaSearch()
  const { state, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  // dev builds, and the shared demo build (VITE_DEMO), where these switches are how people explore
  if (!import.meta.env.DEV && !import.meta.env.VITE_DEMO) return null

  const summary = {
    search,
    status: state.status,
    theme: state.theme,
    versions: state.versions.map((v) => `v${v.n}: ${v.message}`),
    comments: state.comments.map(
      (c) =>
        `${c.id} ${c.status}${c.suggestion ? ` suggestion:${c.suggestion.state}` : ''} ${c.file.split('/').pop()} ${c.anchor.type === 'selection' ? `"${c.anchor.quote.slice(0, 40)}"` : c.anchor.type === 'section' ? `§${c.anchor.section}` : '(file)'} +${c.replies.length} replies`,
    ),
    activity: state.activity.map((a) => a.text),
  }

  return (
    <>
      {open && <pre className="proto-state">{JSON.stringify(summary, null, 2)}</pre>}
      <div className="proto-dev">
        {import.meta.env.VITE_SITE_URL && (
          <a className="proto-state-btn" href={import.meta.env.VITE_SITE_URL} title="Back to the rest of the site (experiment 2)">
            ← site
          </a>
        )}
        <label className="proto-state-btn" title="Prototype only: the deployment's external image setting (a site admin decision)">
          external images
          <select value={state.externalImages} onChange={(e) => dispatch({ type: 'setExternalImages', mode: e.target.value as ExternalImages })}>
            <option value="click">click to show</option>
            <option value="always">always</option>
            <option value="never">never</option>
          </select>
        </label>
        <button className="proto-state-btn" onClick={() => setOpen((o) => !o)} title="Show the prototype's in-memory state">
          {open ? 'hide state' : 'state'}
        </button>
      </div>
    </>
  )
}
