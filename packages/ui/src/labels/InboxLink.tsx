// Your notifications, as an envelope with how many are unread on its corner:
// 1 to 99 as they are, "99+" past that, and no badge at all for none. The
// word the icon drops is in its name and tooltip ("Notifications, 2 unread"),
// and on the inbox itself it looks current, as a navigation link does.
import { Link } from '../link/Link.tsx'
import { Icon } from './Icon.tsx'
import './InboxLink.css'

export interface InboxLinkProps {
  href: string
  unread: number
  /** The inbox is the page being shown. */
  current?: boolean
}

export function InboxLink({ href, unread, current = false }: InboxLinkProps) {
  const shown = unread > 99 ? '99+' : String(unread)
  // the figure as shown, so what's read out matches what's seen
  const name = unread > 0 ? `Notifications, ${shown} unread` : 'Notifications'
  return (
    <Link href={href} className="inbox-link" aria-label={name} title={name} aria-current={current ? 'page' : undefined}>
      <Icon name="inbox" />
      {unread > 0 && (
        <span className="inbox-link-count" aria-hidden>
          {shown}
        </span>
      )}
    </Link>
  )
}
