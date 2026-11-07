// An idea's versions, newest first: who made each and when, and how (with
// edit commands, an upload, or when it was created). Each can be viewed, and
// an earlier one compared against: the document then shows what changed since.
import { type Actor, ActorLabel, Link, RelativeTime, Tag } from '@ideaf/ui'
import { plural } from '../../../../../plural.ts'
import './VersionList.css'

export interface VersionInfo {
  number: number
  by: Actor
  at: number
  how: 'created' | 'commands' | 'upload'
  /** Edit commands in it, for how: 'commands'. */
  steps: number
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
}

export function VersionList({ versions, viewing, latest, base, viewHref, compareHref }: VersionListProps) {
  return (
    <ol className="version-list" aria-label="Versions">
      {versions.map((v) => {
        const classes = [
          'version',
          v.number === viewing && 'is-viewing',
          v.number === base && 'is-base',
          base !== null && v.number > base && v.number <= viewing && 'in-range',
        ]
        return (
          <li key={v.number} className={classes.filter(Boolean).join(' ')}>
            <div className="version-head">
              <Link href={viewHref(v.number)} aria-current={v.number === viewing ? 'page' : undefined}>
                v{v.number}
              </Link>
              {v.number === viewing && <Tag>viewing</Tag>}
              {v.number === latest && v.number !== viewing && <Tag tone="faint">latest</Tag>}
              {v.number === base && <Tag tone="warn">compared against</Tag>}
              <span className="version-time">
                <RelativeTime at={v.at} />
              </span>
            </div>
            <div className="version-how">{describe(v)}</div>
            <div className="version-foot">
              <ActorLabel actor={v.by} short />
              {v.number < viewing && v.number !== base && (
                <Link className="version-compare" href={compareHref(v.number)}>
                  Changes since
                </Link>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** "Created", "Uploaded from files", "Edited with 3 commands". */
export function describe(v: Pick<VersionInfo, 'how' | 'steps'>): string {
  if (v.how === 'created') {
    return 'Created'
  }
  return v.how === 'upload' ? 'Uploaded from files' : `Edited with ${plural(v.steps, 'command')}`
}
