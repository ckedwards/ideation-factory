// PROTOTYPE: dev-only "state" button that shows the in-memory state, so you
// can see what each action changed. Not part of the design.
import { useState } from 'react'
import { useStore } from './store'
import { useIdeaSearch } from './lib'

export function DevState() {
  const [search] = useIdeaSearch()
  const { state } = useStore()
  const [open, setOpen] = useState(false)
  if (!import.meta.env.DEV) return null

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
    reattaching: state.reattachId,
  }

  return (
    <>
      {open && <pre className="proto-state">{JSON.stringify(summary, null, 2)}</pre>}
      <button className="proto-state-btn" onClick={() => setOpen((o) => !o)} title="Show the prototype's in-memory state">
        {open ? 'hide state' : 'state'}
      </button>
    </>
  )
}
