// Your place in a team or group, in its page's header: your role, and its
// settings if you can manage it (maintainers and admins); or a button to ask
// to join, or that you've asked.
import { Button, Link, Tag } from '@ideaf/ui'
import './Membership.css'

export interface MembershipProps {
  role: 'admin' | 'maintainer' | 'member' | null
  /** You've asked to join, and are waiting. */
  requested: boolean
  settingsHref: string
  onJoin: () => void
  joining?: boolean
}

export function Membership({ role, requested, settingsHref, onJoin, joining = false }: MembershipProps) {
  if (role) {
    return (
      <span className="membership">
        <Tag tone={role === 'admin' ? 'admin' : 'neutral'}>
          {role === 'member' ? 'You’re a member' : `You’re ${aOrAn(role)}`}
        </Tag>
        {role !== 'member' && <Link href={settingsHref}>Settings</Link>}
      </span>
    )
  }
  if (requested) {
    return <Tag tone="faint">Asked to join: waiting for a maintainer</Tag>
  }
  return (
    <Button onClick={onJoin} disabled={joining}>
      {joining ? 'Asking…' : 'Ask to join'}
    </Button>
  )
}

const aOrAn = (role: string) => (/^[aeiou]/.test(role) ? `an ${role}` : `a ${role}`)
