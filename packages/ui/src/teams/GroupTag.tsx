import { Link } from '../link/Link.tsx'
import './GroupTag.css'

export interface GroupRef {
  name: string
  // deleted groups stay as a record, so what still names one can say so
  deleted?: boolean
}

export interface GroupTagProps {
  group: GroupRef
  // the group's page
  href?: string | undefined
}

// A group (a reviewer, a member of a rule) as a small tag. A deleted group is
// struck through and says "deleted", so nothing points at one silently.
export function GroupTag({ group, href }: GroupTagProps) {
  if (group.deleted) {
    return (
      <span className="group-tag group-tag-deleted" title="This group was deleted">
        <s>{group.name}</s> · deleted
      </span>
    )
  }
  if (href) {
    return (
      <Link href={href} className="group-tag">
        <span className="visually-hidden">Group: </span>
        {group.name}
      </Link>
    )
  }
  return (
    <span className="group-tag">
      <span className="visually-hidden">Group: </span>
      {group.name}
    </span>
  )
}
