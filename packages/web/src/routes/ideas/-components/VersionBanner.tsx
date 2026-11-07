// Above the document when it isn't simply the latest version: an older one
// (read only, with the way back), or the changes since an earlier one.
import { type Actor, ActorLabel, Link, RelativeTime } from '@ideaf/ui'
import './VersionBanner.css'

export type VersionBannerProps =
  | {
      kind: 'older'
      version: number
      latest: number
      by: Actor
      at: number
      /** Back to the latest, and what changed since this one. */
      latestHref: string
      changesHref: string
    }
  | {
      kind: 'compare'
      version: number
      base: number
      /** Back to reading the version without the changes. */
      stopHref: string
    }

export function VersionBanner(props: VersionBannerProps) {
  if (props.kind === 'compare') {
    return (
      <div className="version-banner is-compare" role="status">
        <span>
          <b>Changes since v{props.base}</b> · in v{props.version}: added text is underlined, removed text struck
          through
        </span>
        <Link href={props.stopHref}>Stop comparing</Link>
      </div>
    )
  }
  return (
    <div className="version-banner is-older" role="status">
      <span>
        <b>Older version: v{props.version}</b> · the latest is v{props.latest}. Made <RelativeTime at={props.at} /> by{' '}
        <ActorLabel actor={props.by} short /> · read only
      </span>
      <span className="version-banner-links">
        <Link href={props.changesHref}>What’s changed since</Link>
        <Link href={props.latestHref}>Back to the latest</Link>
      </span>
    </div>
  )
}
