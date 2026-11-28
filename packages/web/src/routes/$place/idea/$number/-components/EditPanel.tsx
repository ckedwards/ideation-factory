// Editing the idea's draft. The actions, in the idea's bar while the editor's
// open (IdeaMode, or the focus view's top line): the draft's changes, committing
// it as one version, previewing it, discarding it, and closing the editor. The
// changes are for when you want them, not beside the page: a button opens them in
// a dialog (the panel: each change, the faces of who typed in it, "Undo this
// change", why one is outdated if it is, and what committing would do to the
// comments). The draft is everyone's who can edit (docs/handoff-live-editing.md,
// step 5), and discarding it asks first.
//
// Commit opens a dialog first, every time (docs: Committing the draft): how many
// changes in how many files, by whom; a warning while someone else is still
// typing; and the files it takes, shaped like the Files tree, with what happens to
// each (a rename is its old name struck through beside the new one: the only place
// a rename shows). A file opens its comparison.
import { type CSSProperties, useState } from 'react'
import { AvatarStack, Button, Dialog, Icon, isImage, Section, Stack, type Person } from '@ideaf/ui'
import type { CommitRow } from './commit-files.ts'
import './EditPanel.css'

export interface ChangeRow {
  key: string
  label: string
  /** Who made it: everyone who typed in it, the last first. */
  authors: Person[]
  /** Why it no longer applies (outdated), if it doesn't. */
  problem?: string | null | undefined
}

/** Someone with changes in the draft, for the commit dialog. */
export interface Contributor {
  key: string
  person: Person
  /** How many of the draft's changes they typed in. */
  changes: number
  /** The section they're typing in now ("Why"), "" if it has no heading; null if they aren't typing. */
  typingIn: string | null
  you: boolean
}

/**
 * The draft as committing takes it, when it's not only yours: everyone with changes, other people
 * first. Null when nobody else is in the draft or has changes in it.
 */
export interface Together {
  changes: number
  files: number
  people: Contributor[]
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
  /** How many files they change (their text, their path, made or deleted). */
  files?: number
  /** Where each comment would be once it's committed. */
  outcomes: CommentOutcomeRow[]
  previewing: boolean
  committing: boolean
  /** Typed on the page and not saved yet: Commit and Preview save it first, so they can go ahead. */
  unsaved?: boolean
  /** Who else committing takes from; null if nobody. */
  together?: Together | null
  /** The files committing takes, as its dialog lists them. */
  commitFiles?: CommitRow[]
  /** Open a file's comparison with the latest version (from the commit dialog). */
  onCompareFile?: (file: string) => void
  /** The commit dialog opened: what it shows is read again, so who's typing is now. */
  onConfirming?: () => void
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
                    <span className="edit-panel-label">{change.label}</span>
                    <Button size="sm" variant="link" onClick={() => props.onUndo(change.key)}>
                      Undo this change
                    </Button>
                    {change.authors.length > 0 && (
                      <span className="edit-panel-by">
                        <span className="visually-hidden">By </span>
                        <AvatarStack people={change.authors} max={4} />
                      </span>
                    )}
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
  const { changes, together } = props
  const [discarding, setDiscarding] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [listing, setListing] = useState(false)
  const outdated = changes.filter((c) => c.problem).length
  // anything typed counts at once, before its save is in
  const changed = changes.length > 0 || props.unsaved === true
  return (
    <>
      {changes.length > 0 && (
        <Button
          variant="ghost"
          className={outdated > 0 ? 'edit-changes is-outdated' : 'edit-changes'}
          aria-haspopup="dialog"
          onClick={() => setListing(true)}
        >
          {plural(changes.length, 'change')}
          {(props.files ?? 0) > 1 && ` in ${plural(props.files!, 'file')}`}
          {outdated > 0 && ` · ${outdated} outdated`}
        </Button>
      )}
      <Button
        variant="primary"
        disabled={!changed || outdated > 0 || props.committing}
        onClick={() => {
          setConfirming(true)
          props.onConfirming?.()
        }}
      >
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
          {changes.length === 1 ? '1 change' : `${changes.length} changes`}
          {together ? `, by ${namesOf(together.people)}` : ''}.
        </p>
      </Dialog>
      <Dialog open={listing} title="The draft’s changes" onClose={() => setListing(false)}>
        <EditPanel {...props} />
      </Dialog>
      <Dialog
        open={confirming}
        title={`Commit as v${props.version + 1}`}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={outdated > 0 || props.committing}
              onClick={() => {
                setConfirming(false)
                props.onCommit()
              }}
            >
              {together ? 'Commit for everyone' : 'Commit'}
            </Button>
          </>
        }
      >
        <Stack gap={3}>
          <p className="edit-panel-lead">
            {(together?.changes ?? changes.length) === 0
              ? 'What you’ve just typed: it’s saved, then committed'
              : plural(together?.changes ?? changes.length, 'change')}
            {(together?.files ?? props.files ?? 0) > 0 && ` in ${plural(together?.files ?? props.files!, 'file')}`}
            {together ? `, by ${namesOf(together.people)}` : ''}.
          </p>
          <StillTyping people={together?.people ?? []} next={props.version + 1} />
          {(props.commitFiles ?? []).length > 0 && (
            <ul className="commit-files" aria-label="Files">
              {props.commitFiles!.map((row) => (
                <CommitFile
                  key={`${row.kind}:${row.path}`}
                  row={row}
                  onCompare={
                    props.onCompareFile &&
                    ((file) => {
                      setConfirming(false)
                      props.onCompareFile!(file)
                    })
                  }
                />
              ))}
            </ul>
          )}
        </Stack>
      </Dialog>
    </>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * A warning, while someone else with changes is typing: what they type after you commit isn't in the
 * version, it stays in the draft.
 */
function StillTyping({ people, next }: { people: Contributor[]; next: number }) {
  const typing = people.filter((p) => !p.you && p.typingIn !== null)
  if (typing.length === 0) {
    return null
  }
  const where = typing.length === 1 && typing[0]!.typingIn ? ` in “${typing[0]!.typingIn}”` : ''
  return (
    <p className="commit-warning" role="alert">
      <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <path d="M8 2 14.5 13.5h-13z" />
        <path d="M8 6.5v3.5M8 11.75v.01" />
      </svg>
      <span>
        <strong>
          {namesOf(typing)} {typing.length === 1 ? 'is' : 'are'} still typing
        </strong>
        {where}. Anything typed after you commit isn’t in v{next}: it stays in the draft for the next version.
      </span>
    </p>
  )
}

/** A row of the commit's files: a folder, or a file that opens its comparison. */
function CommitFile({ row, onCompare }: { row: CommitRow; onCompare: ((file: string) => void) | undefined }) {
  const inner = (
    <>
      <Icon name={row.kind === 'folder' ? 'folderOpen' : isImage(row.path) ? 'image' : 'page'} />
      <span className="commit-file-name">
        {row.was && (
          <s className="commit-file-was">
            <span className="visually-hidden">was </span>
            {row.was}
          </s>
        )}
        <span className="commit-file-now">{row.name}</span>
      </span>
      {row.note && <span className="commit-file-note">{row.note}</span>}
    </>
  )
  const props = {
    className: ['commit-file', row.state && `is-${row.state}`].filter(Boolean).join(' '),
    style: { '--depth': row.depth } as CSSProperties,
  }
  return (
    <li>
      {row.file && onCompare ? (
        <button type="button" {...props} onClick={() => onCompare(row.file!)}>
          {inner}
        </button>
      ) : (
        <div {...props}>{inner}</div>
      )}
    </li>
  )
}

/** "Priya, Zoe and you": everyone with changes, as the commit dialog lists them. */
function namesOf(people: Contributor[]): string {
  const names = people.map((p) => (p.you ? 'you' : p.person.name))
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? 'nobody')
}
