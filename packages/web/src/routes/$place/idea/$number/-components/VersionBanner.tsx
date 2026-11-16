// Above the document when it's an older version: read only, with the way back to the latest and to
// what's changed since. (Comparing is the document's toolbar's: DocToolbar.)
import { type Actor, ActorLabel, Link, RelativeTime } from '@ideaf/ui'
import './VersionBanner.css'

export interface VersionBannerProps {
  kind: 'older'
  version: number
  latest: number
  by: Actor
  at: number
  /** Back to the latest, and what changed since this one. */
  latestHref: string
  changesHref: string
}

export function VersionBanner(props: VersionBannerProps) {
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
