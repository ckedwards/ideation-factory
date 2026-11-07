// People asking to join a team or group, for its maintainers and admins to
// let in or turn away.
import { Button, Empty, type Person, UserName } from '@ideaf/ui'
import './ContainerList.css'
import './MemberManager.css'

export interface JoinRequestsProps {
  people: Person[]
  onDecide: (person: Person, approve: boolean) => void
}

export function JoinRequests({ people, onDecide }: JoinRequestsProps) {
  if (people.length === 0) {
    return <Empty>Nobody is asking to join.</Empty>
  }
  return (
    <ul className="container-list" aria-label="Asking to join">
      {people.map((person) => (
        <li key={person.id} className="container-row member-row">
          <UserName person={person} withAvatar />
          <span className="member-row-actions">
            <Button size="sm" variant="primary" onClick={() => onDecide(person, true)}>
              Let in
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDecide(person, false)}>
              Turn away
            </Button>
          </span>
        </li>
      ))}
    </ul>
  )
}
