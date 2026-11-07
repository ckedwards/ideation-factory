// Sharing an idea with someone more: a person, a group, a team's members, or
// everyone on the site (who can only view).
import { useState } from 'react'
import { Button, type Person, Select } from '@ideaf/ui'
import { GroupPicker, type GroupRef } from '../../../../../components/GroupPicker.tsx'
import { PersonPicker } from '../../../../../components/PersonPicker.tsx'
import { TeamPicker, type TeamRefLite } from '../../../../../components/TeamPicker.tsx'
import { type Level, LEVELS } from './access.ts'
import type { Subject } from './subjects.ts'
import './AccessList.css'

type Kind = 'user' | 'group' | 'team' | 'everyone'

export interface ShareAdderProps {
  onShare: (subject: Subject, level: Level) => void
}

export function ShareAdder({ onShare }: ShareAdderProps) {
  const [kind, setKind] = useState<Kind>('user')
  const [person, setPerson] = useState<Person | null>(null)
  const [group, setGroup] = useState<GroupRef | null>(null)
  const [team, setTeam] = useState<TeamRefLite | null>(null)
  const [level, setLevel] = useState<Level>('view')
  const subject: Subject | null =
    kind === 'everyone'
      ? { kind }
      : kind === 'user'
        ? person && { kind, id: person.id }
        : kind === 'group'
          ? group && { kind, id: group.id }
          : team && { kind, id: team.id }
  return (
    <form
      className="share-adder"
      onSubmit={(event) => {
        event.preventDefault()
        if (subject) {
          onShare(subject, kind === 'everyone' ? 'view' : level)
          setPerson(null)
          setGroup(null)
          setTeam(null)
        }
      }}
    >
      <Select
        aria-label="Share with"
        options={[
          { value: 'user', label: 'A person' },
          { value: 'group', label: 'A group' },
          { value: 'team', label: 'A team’s members' },
          { value: 'everyone', label: 'Everyone on the site' },
        ]}
        value={kind}
        onChange={setKind}
      />
      {kind !== 'everyone' && (
        <div className="share-adder-who">
          {kind === 'user' && <PersonPicker label="Who" value={person} onChange={setPerson} />}
          {kind === 'group' && <GroupPicker label="Which group" value={group} onChange={setGroup} />}
          {kind === 'team' && <TeamPicker label="Which team" value={team} onChange={setTeam} />}
        </div>
      )}
      {kind !== 'everyone' && (
        <Select aria-label="What they can do" options={LEVELS} value={level} onChange={setLevel} />
      )}
      <Button type="submit" variant="primary" disabled={!subject}>
        Share
      </Button>
    </form>
  )
}
