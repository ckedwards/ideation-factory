// The panel beside the idea's draft: its changes, who made each, Undo, and why
// one is outdated if it is; what committing would do to the comments; and
// committing it as one version, or discarding it. The draft is everyone's who
// can edit, so discarding asks first.
import { useState } from 'react'
import { Button, Section, Stack } from '@ideaf/ui'
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
  const [discarding, setDiscarding] = useState(false)
  const outdated = changes.filter((c) => c.problem).length
  // comments the draft touches; the rest stay as they are
  const touched = props.outcomes.filter((o) => o.state !== 'exact')
  return (
    <div className="edit-panel">
      <Stack gap={4}>
        <p className="edit-panel-lead">
          You’re editing the draft, on v{props.version}. Everyone who can edit works on it together, and committing it
          makes v{props.version + 1}.
        </p>
        {changes.length === 0 ? (
          // the instruction first: there's nothing to count yet
          <p className="edit-panel-lead">Hover a block to edit it, add text below it or delete it.</p>
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
        {discarding ? (
          <div className="edit-panel-confirm" role="group" aria-label="Discard the draft">
            <span>Discard every change in the draft, for everyone?</span>
            <div className="edit-panel-buttons">
              <Button
                variant="danger"
                onClick={() => {
                  setDiscarding(false)
                  props.onDiscard()
                }}
              >
                Discard the draft
              </Button>
              <Button variant="ghost" onClick={() => setDiscarding(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <div className="edit-panel-buttons">
            <Button
              variant="primary"
              disabled={changes.length === 0 || outdated > 0 || props.committing}
              onClick={props.onCommit}
            >
              {props.committing ? 'Committing…' : `Commit as v${props.version + 1}`}
            </Button>
            <Button disabled={changes.length === 0} onClick={() => props.onPreview(!props.previewing)}>
              {props.previewing ? 'Back to editing' : 'Preview'}
            </Button>
            {changes.length > 0 && (
              <Button variant="ghost" onClick={() => setDiscarding(true)}>
                Discard
              </Button>
            )}
            <Button variant="ghost" onClick={props.onClose}>
              Close editor
            </Button>
            <span className="edit-panel-note edit-panel-stays">Your changes stay in the draft.</span>
          </div>
        )}
      </Stack>
    </div>
  )
}
