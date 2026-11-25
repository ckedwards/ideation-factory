// An idea's versions, newest first, as a timeline: who made each, when and how. The one shown is
// marked; any other can be shown, or compared with it (the document then shows what changed, and
// the toolbar's Comparing menu changes either version).
//
// The draft, if there is one, heads the list: what the next version will be. Reading, it opens in
// the editor; while it's open, it lists its changes, and is compared with any version from here, in
// place of the editor, until it's back to editing.
import type { ReactNode } from 'react'
import { type Actor, ActorLabel, AvatarStack, Button, Link, type Person, RelativeTime, Tag } from '@ideaf/ui'
import { plural } from '../../../../../plural.ts'
import './VersionList.css'

export interface VersionInfo {
  number: number
  by: Actor
  /** Who made what's in it: for a committed draft, everyone who typed in it. */
  authors?: Person[]
  at: number
  how: 'created' | 'commands' | 'upload'
  /** Edit commands in it, for how: 'commands'. */
  steps: number
}

/** The draft, as the list shows it. */
export interface DraftVersion {
  /** The version it's on. */
  on: number
  changes: number
  /** Who made its changes. */
  by: string[]
  /** It's open in the editor. */
  open?: boolean
  /** Opens it in the editor (reading). */
  onOpen?: (() => void) | undefined
  /** While it's open: the version it's compared with (null: it's being edited), and changing that. */
  comparedWith?: number | null
  onCompare?: (version: number | null) => void
  /** While it's open: its changes, each with Undo, and where comments go. */
  detail?: ReactNode
}

export interface VersionListProps {
  /** Newest first. */
  versions: VersionInfo[]
  viewing: number
  latest: number
  /** The version compared against, if comparing. */
  base: number | null
  /** Where viewing a version goes, and comparing the one viewed against an earlier one. */
  viewHref: (version: number) => string
  compareHref: (base: number) => string
  /** The draft, if there's one to show. */
  draft?: DraftVersion | undefined
}

export function VersionList({ versions, viewing, latest, base, viewHref, compareHref, draft }: VersionListProps) {
  const editing = draft?.open === true
  // while editing, the draft is what's shown, and what's compared is against it
  const comparedWith = editing ? (draft.comparedWith ?? null) : base
  const top = editing ? latest : viewing
  return (
    <ol className="version-list" aria-label="Versions">
      {draft && (
        <li
          className={['version', 'is-draft', editing && 'is-viewing', editing && comparedWith !== null && 'in-range']
            .filter(Boolean)
            .join(' ')}
          aria-current={editing ? 'page' : undefined}
        >
          <div className="version-head">
            <span className="version-name">Draft</span>
            {editing ? (
              <Tag>{comparedWith === null ? 'editing' : 'comparing'}</Tag>
            ) : (
              <Tag tone="dashed">not committed</Tag>
            )}
            <span className="version-time">
              {draft.changes === 0 ? 'No changes yet' : plural(draft.changes, 'change')}
            </span>
          </div>
          <div className="version-meta">
            <span>On v{draft.on}</span>
            {draft.by.length > 0 && <span className="version-how">by {draft.by.join(', ')}</span>}
          </div>
          {editing
            ? draft.changes > 0 &&
              draft.onCompare && (
                <div className="version-actions">
                  <Button size="sm" onClick={() => draft.onCompare?.(comparedWith === null ? draft.on : null)}>
                    {comparedWith === null ? `Compare with v${draft.on}` : 'Back to editing'}
                  </Button>
                </div>
              )
            : draft.onOpen && (
                <div className="version-actions">
                  <Button size="sm" onClick={draft.onOpen}>
                    Open the draft
                  </Button>
                </div>
              )}
          {draft.detail && <div className="version-detail">{draft.detail}</div>}
        </li>
      )}
      {versions.map((v) => {
        const shown = !editing && v.number === viewing
        const compared = v.number === comparedWith
        const classes = [
          'version',
          shown && 'is-viewing',
          v.number === latest && 'is-latest',
          compared && 'is-base',
          comparedWith !== null && v.number > comparedWith && v.number <= top && 'in-range',
        ]
        return (
          <li key={v.number} className={classes.filter(Boolean).join(' ')}>
            <div className="version-head">
              <Link className="version-name" href={viewHref(v.number)} aria-current={shown ? 'page' : undefined}>
                Version {v.number}
              </Link>
              {shown && <Tag>viewing</Tag>}
              {v.number === latest && !shown && <Tag tone="faint">latest</Tag>}
              {compared && <Tag tone="warn">{editing ? 'compared with the draft' : 'compared against'}</Tag>}
              <span className="version-time">
                <RelativeTime at={v.at} />
              </span>
            </div>
            <div className="version-meta">
              <ActorLabel actor={v.by} short />
              {typedBy(v) && (
                <span className="version-authors">
                  <span className="visually-hidden">Typed by </span>
                  <AvatarStack people={typedBy(v)!} max={5} />
                </span>
              )}
              <span className="version-how">{describe(v)}</span>
            </div>
            {editing
              ? draft.changes > 0 &&
                draft.onCompare && (
                  <div className={`version-actions${compared ? '' : ' is-quiet'}`}>
                    <Button size="sm" variant="link" onClick={() => draft.onCompare?.(compared ? null : v.number)}>
                      {compared ? 'Back to editing' : 'Compare with the draft'}
                    </Button>
                  </div>
                )
              : v.number < viewing &&
                !compared && (
                  <div className="version-actions is-quiet">
                    <Link className="version-compare" href={compareHref(v.number)}>
                      Compare with v{viewing}
                    </Link>
                  </div>
                )}
          </li>
        )
      })}
    </ol>
  )
}

/** Who typed in a committed draft, when it's more than whoever committed it; null otherwise. */
function typedBy(v: VersionInfo): Person[] | null {
  const authors = v.authors ?? []
  const committer = v.by.kind === 'person' ? v.by.person.id : null
  return authors.length > 1 || (authors.length === 1 && authors[0]!.id !== committer) ? authors : null
}

/** "Created", "Uploaded from files", "Edited with 3 commands". */
export function describe(v: Pick<VersionInfo, 'how' | 'steps'>): string {
  if (v.how === 'created') {
    return 'Created'
  }
  return v.how === 'upload' ? 'Uploaded from files' : `Edited with ${plural(v.steps, 'command')}`
}
