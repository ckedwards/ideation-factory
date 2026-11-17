// The way home on pages that leave out the site's navigation for the width (an idea's files), and the
// phone's bar across the top: the site's name, leading home, and your notifications (the envelope, with how
// many are unread).
import { InboxLink, Link } from '@ideaf/ui'
import { useQuery } from '@tanstack/react-query'
import { unreadQuery } from '../api.ts'
import './SiteLinks.css'

export function SiteLinks({ bar = false }: { bar?: boolean }) {
  const unread = useQuery(unreadQuery).data ?? 0
  return (
    <nav className={`site-links${bar ? ' site-links-bar' : ''}`} aria-label="Site">
      <Link className="site-links-home" href="/">
        <span aria-hidden>✳</span> Ideation Factory
      </Link>
      <InboxLink href="/notifications" unread={unread} />
    </nav>
  )
}
