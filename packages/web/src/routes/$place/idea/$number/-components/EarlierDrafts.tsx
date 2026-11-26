// The draft's earlier drafts (its restore points), in the list of versions under the draft while it's
// open: each named by when it was kept and who changed what since the one before, or, when it was
// kept before something, by that ("Before Priya discarded it"). One opened shows in the page, read-only,
// marked against the draft now (EarlierDraftBand); restoring or deleting one asks first
// (EarlierDraftDialogs). One dropped to make room keeps its row, without Restore.
import { Button, Dialog, formatAgo, RelativeTime, useNow } from '@ideaf/ui'
import { useState } from 'react'
import { plural } from '../../../../../plural.ts'
import './EarlierDrafts.css'

export interface EarlierDraft {
  point: number
  at: number
  /** What it was kept before ("Before Priya discarded it"); null when it went quiet or someone left. */
  reason: string | null
  /** Who changed it since the one before, by name. */
  who: string[]
  changes: number
  /** The first change since the one before, in words ("Added “Bring the list.”"), and how many more. */
  first: string | null
  more: number
  /** How many of the one before's changes it doesn't have. */
  undone: number
  /** The version it was kept on, when that's older than the draft's now. */
  on: number | null
  /** False once it's been dropped to make room for newer ones. */
  kept: boolean
  /** Whether you may delete it: the idea's owner, or someone who made one of its changes. */
  canDelete: boolean
}

export interface EarlierDraftsProps {
  /** The latest first. */
  drafts: EarlierDraft[]
  /** The one shown in the page, if any. */
  opened: number | null
  onOpen: (point: number | null) => void
  onRestore: (point: number) => void
  onDelete: (point: number) => void
}

/** How many show before "Show N more". */
const SHOWN = 3

/** The earlier drafts, as entries of the list of versions (VersionList), under the draft. */
export function EarlierDraftItems({ drafts, opened, onOpen, onRestore, onDelete }: EarlierDraftsProps) {
  const [all, setAll] = useState(false)
  if (drafts.length === 0) {
    return null
  }
  // the one opened stays in sight, however far down it is
  const shown = all ? drafts : drafts.filter((d, i) => i < SHOWN || d.point === opened)
  return (
    <>
      <li className="earlier-drafts-head">
        <h3>Earlier drafts</h3>
      </li>
      {shown.map((d) => {
        const isOpen = d.point === opened
        return (
          <li
            key={d.point}
            className={['version', 'is-earlier', isOpen && 'is-viewing', !d.kept && 'is-gone']
              .filter(Boolean)
              .join(' ')}
            aria-current={isOpen ? 'page' : undefined}
          >
            <div className="version-head">
              {d.kept ? (
                <button
                  type="button"
                  className="version-name earlier-draft-name"
                  aria-pressed={isOpen}
                  onClick={() => onOpen(isOpen ? null : d.point)}
                >
                  {d.reason ?? <RelativeTime at={d.at} />}
                </button>
              ) : (
                <span className="version-name">{d.reason ?? <RelativeTime at={d.at} />}</span>
              )}
              {d.reason && (
                <span className="version-time">
                  <RelativeTime at={d.at} />
                </span>
              )}
            </div>
            <div className="version-meta">
              {d.reason ? <span>{plural(d.changes, 'change')}</span> : null}
              {d.who.length > 0 && <span>{d.who.join(', ')}</span>}
              {d.on !== null && <span>on v{d.on}</span>}
            </div>
            {!d.reason && <Summary draft={d} />}
            {!d.kept && <p className="earlier-draft-gone">No longer kept: dropped to make room for newer ones</p>}
            {(isOpen || !d.kept) && (
              <div className="version-actions">
                {d.kept && (
                  <Button size="sm" variant="primary" onClick={() => onRestore(d.point)}>
                    Restore this draft
                  </Button>
                )}
                {d.canDelete && (
                  <Button size="sm" variant="link" onClick={() => onDelete(d.point)}>
                    Delete
                  </Button>
                )}
              </div>
            )}
          </li>
        )
      })}
      {drafts.length > shown.length && (
        <li className="earlier-drafts-more">
          <Button size="sm" variant="link" onClick={() => setAll(true)}>
            Show {drafts.length - shown.length} more
          </Button>
        </li>
      )}
    </>
  )
}

/** What changed since the one before, in a line: "Added “Bring the list.” and 1 more". */
function Summary({ draft }: { draft: EarlierDraft }) {
  if (draft.first) {
    return (
      <p className="earlier-draft-summary">
        {draft.first}
        {draft.more > 0 ? ` and ${draft.more} more` : ''}
      </p>
    )
  }
  if (draft.undone > 0) {
    return <p className="earlier-draft-summary">Took back {plural(draft.undone, 'change')}</p>
  }
  return <p className="earlier-draft-summary">{plural(draft.changes, 'change')}</p>
}

export interface EarlierDraftBandProps {
  draft: EarlierDraft
  /** How many of its changes would come back held: a version since has outdated them. */
  held: number
  onBack: () => void
  onRestore: () => void
}

/** Over the page while an earlier draft is shown in it: which, how to read it, and the way back. */
export function EarlierDraftBand({ draft, held, onBack, onRestore }: EarlierDraftBandProps) {
  const now = useNow()
  return (
    <div className="earlier-draft-band" role="region" aria-label="An earlier draft">
      <div>
        <p className="earlier-draft-band-title">
          {draft.reason ?? `The draft from ${formatAgo(draft.at, now)}`}
          {draft.reason && <span className="earlier-draft-band-when"> · {formatAgo(draft.at, now)}</span>}
        </p>
        <p className="earlier-draft-band-how">
          Read-only. Restoring adds what’s underlined and takes out what’s struck through.
          {held > 0 && ` ${held} of its changes would come back outdated: a version since changed the same words.`}
        </p>
      </div>
      <div className="earlier-draft-band-actions">
        <Button onClick={onBack}>Back to the draft</Button>
        <Button variant="primary" onClick={onRestore}>
          Restore this draft
        </Button>
      </div>
    </div>
  )
}

export interface EarlierDraftDialogsProps {
  /** Restoring or deleting one, asked first; null when nothing is being asked. */
  asking: { kind: 'restore' | 'delete'; draft: EarlierDraft } | null
  /** How many changes the draft has now. */
  changes: number
  onCancel: () => void
  onConfirm: () => void
}

/** Restoring replaces the draft for everyone; deleting can't be taken back: both ask first. */
export function EarlierDraftDialogs({ asking, changes, onCancel, onConfirm }: EarlierDraftDialogsProps) {
  const now = useNow()
  const restoring = asking?.kind === 'restore'
  const when = asking ? formatAgo(asking.draft.at, now) : ''
  return (
    <Dialog
      open={asking !== null}
      title={restoring ? `Restore the draft from ${when}?` : 'Delete this earlier draft?'}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={restoring ? 'primary' : 'danger'} onClick={onConfirm}>
            {restoring ? 'Restore for everyone' : 'Delete it'}
          </Button>
        </>
      }
    >
      {asking &&
        (restoring ? (
          <>
            <p className="edit-panel-lead">
              This replaces the draft for everyone editing it: it has {plural(changes, 'change')} now, and had{' '}
              {asking.draft.changes} then.
            </p>
            <p className="earlier-draft-note">The draft as it is now is kept too, so you can go back to it.</p>
          </>
        ) : (
          <p className="edit-panel-lead">
            The draft from {when} is gone for good, for everyone: it can’t be restored after this.
          </p>
        ))}
    </Dialog>
  )
}
