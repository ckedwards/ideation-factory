// Editing the idea's draft, in two places. The panel beside the document: its
// changes, who made each, Undo, and why one is outdated if it is; and what
// committing would do to the comments. The actions, in the idea's bar while
// the editor's open (IdeaMode): committing it as one version, previewing it,
// discarding it, and closing the editor. The draft is everyone's who can edit,
// so discarding asks first.
import { useState } from 'react'
import { Button, Dialog, Section, Stack } from '@ideaf/ui'
import './EditPanel.css'

export interface ChangeRow {
  key: string
  label: string
  /** Who made it. */
  by: string
  /** Why it no longer applies (outdated), if it doesn't. */
  problem?: string | null | undefined
}

export interface CommentOutcomeRow {
  id: string
  /** What the comment is on, or says. */
  label: string
  state: 'exact' | 'moved' | 'changed' | 'outdated'
}

export interface EditPanelProps {
  /** The version the draft is on: the latest. */
  version: number
  changes: ChangeRow[]
  /** Where each comment would be once it's committed. */
  outcomes: CommentOutcomeRow[]
  previewing: boolean
  committing: boolean
  /** Typed on the page and not saved yet: Commit and Preview save it first, so they can go ahead. */
  unsaved?: boolean
  onUndo: (key: string) => void
  onPreview: (on: boolean) => void
  onCommit: () => void
  onDiscard: () => void
  /** Back to reading: the draft stays. */
  onClose: () => void
}

const SAYS = {
  exact: 'stays where it is',
  moved: 'moves with its text',
  changed: 'stays, on changed text',
  outdated: 'loses its text: outdated',
} as const

export function EditPanel(props: EditPanelProps) {
  const { changes } = props
  const outdated = changes.filter((c) => c.problem).length
  // comments the draft touches; the rest stay as they are
  const touched = props.outcomes.filter((o) => o.state !== 'exact')
  return (
    <div className="edit-panel">
      <Stack gap={4}>
        {changes.length === 0 ? (
          // how to edit is under the file's name; nothing to count yet
          <p className="edit-panel-lead">No changes yet.</p>
        ) : (
          <Section title={changes.length === 1 ? '1 change' : `${changes.length} changes`}>
            {
              <ol className="edit-panel-changes">
                {changes.map((change) => (
                  <li key={change.key} className={change.problem ? 'has-problem' : undefined}>
                    <span className="edit-panel-label">
                      {change.label}
                      <span className="edit-panel-by"> · {change.by}</span>
                    </span>
                    <Button size="sm" variant="link" onClick={() => props.onUndo(change.key)}>
                      Undo
                    </Button>
                    {change.problem && <span className="edit-panel-problem">Outdated: {change.problem}</span>}
                  </li>
                ))}
              </ol>
            }
          </Section>
        )}
        {touched.length > 0 && (
          <Section title="Comments">
            <ul className="edit-panel-outcomes">
              {touched.map((o) => (
                <li key={o.id} className={`is-${o.state}`}>
                  <span className="edit-panel-label">{o.label}</span> <span>{SAYS[o.state]}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {outdated > 0 && (
          <p className="edit-panel-problem">
            {outdated === 1 ? 'A change is' : `${outdated} changes are`} outdated: undo or redo{' '}
            {outdated === 1 ? 'it' : 'them'} to commit.
          </p>
        )}
      </Stack>
    </div>
  )
}

/** Finishing an edit, in the idea's bar: commit, preview, discard (asking first), or close the editor. */
export function EditActions(props: EditPanelProps) {
  const { changes } = props
  const [discarding, setDiscarding] = useState(false)
  const outdated = changes.filter((c) => c.problem).length
  // anything typed counts at once, before its save is in
  const changed = changes.length > 0 || props.unsaved === true
  return (
    <>
      <Button variant="primary" disabled={!changed || outdated > 0 || props.committing} onClick={props.onCommit}>
        {props.committing ? 'Committing…' : `Commit as v${props.version + 1}`}
      </Button>
      <Button disabled={!changed} onClick={() => props.onPreview(!props.previewing)}>
        {props.previewing ? 'Back to editing' : 'Preview'}
      </Button>
      {changes.length > 0 && (
        <Button variant="ghost" onClick={() => setDiscarding(true)}>
          Discard
        </Button>
      )}
      <Button variant="ghost" title="Your changes stay in the draft" onClick={props.onClose}>
        Close editor
      </Button>
      <Dialog
        open={discarding}
        title="Discard the draft?"
        onClose={() => setDiscarding(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDiscarding(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDiscarding(false)
                props.onDiscard()
              }}
            >
              Discard the draft
            </Button>
          </>
        }
      >
        <p className="edit-panel-lead">
          Every change in the draft goes, for everyone who can edit it:{' '}
          {changes.length === 1 ? '1 change' : `${changes.length} changes`}.
        </p>
      </Dialog>
    </>
  )
}
