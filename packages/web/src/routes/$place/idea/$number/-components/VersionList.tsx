// An idea's versions, newest first: who made each and when, and how (with
// edit commands, an upload, or when it was created). Two pickers above them say
// which is shown and what it's compared with, and change either; each version
// can be viewed, and an earlier one compared against: the document then shows
// what changed since.
import { type Actor, ActorLabel, Link, RelativeTime, Select, Tag } from '@ideaf/ui'
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
  /** Showing one version compared with another (or nothing): the pickers above the list. */
  onRange?: (version: number, base: number | null) => void
}

export function VersionList({ versions, viewing, latest, base, viewHref, compareHref, onRange }: VersionListProps) {
  const options = versions.map((v) => ({
    value: String(v.number),
    label: v.number === latest ? `v${v.number} (latest)` : `v${v.number}`,
  }))
  return (
    <>
      {onRange && versions.length > 1 && (
        <div className="version-range" role="group" aria-label="Which versions">
          <label>
            Show
            <Select
              size="sm"
              aria-label="Show version"
              options={options}
              value={String(viewing)}
              onChange={(v) => onRange(Number(v), base !== null && base < Number(v) ? base : null)}
            />
          </label>
          <label>
            compared with
            <Select
              size="sm"
              aria-label="Compared with"
              options={[
                { value: '', label: 'nothing' },
                ...options.filter((o) => Number(o.value) < viewing).map((o) => ({ ...o, label: `v${o.value}` })),
              ]}
              value={base === null ? '' : String(base)}
              onChange={(b) => onRange(viewing, b ? Number(b) : null)}
            />
          </label>
        </div>
      )}
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
    </>
  )
}

/** "Created", "Uploaded from files", "Edited with 3 commands". */
export function describe(v: Pick<VersionInfo, 'how' | 'steps'>): string {
  if (v.how === 'created') {
    return 'Created'
  }
  return v.how === 'upload' ? 'Uploaded from files' : `Edited with ${plural(v.steps, 'command')}`
}
