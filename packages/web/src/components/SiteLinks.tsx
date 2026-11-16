// The way home on pages that leave out the site's navigation for the width (an idea's files): the
// site's name, leading home, and your notifications with how many are new.
import { Link } from '@ideaf/ui'
import { useQuery } from '@tanstack/react-query'
import { unreadQuery } from '../api.ts'
import './SiteLinks.css'

export function SiteLinks() {
  const unread = useQuery(unreadQuery).data ?? 0
  return (
    <nav className="site-links" aria-label="Site">
      <Link className="site-links-home" href="/">
        <span aria-hidden>✳</span> Ideation Factory
      </Link>
      <Link className="site-links-inbox" href="/notifications">
        Notifications
        {unread > 0 && (
          <span className="site-links-count">
            {unread}
            <span className="visually-hidden"> new</span>
          </span>
        )}
      </Link>
    </nav>
  )
}
