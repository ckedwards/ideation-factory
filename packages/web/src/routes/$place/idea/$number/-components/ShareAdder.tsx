// Sharing an idea with someone more: a person, a group, a team's members, or everyone on the site (who
// can only view), found in one box, with what they can do.
import { useState } from 'react'
import { Button, Select } from '@ideaf/ui'
import { type Picked, SubjectPicker } from '../../../../../components/SubjectPicker.tsx'
import { type Level, LEVELS } from './access.ts'
import type { Subject } from './subjects.ts'
import './AccessList.css'

export interface ShareAdderProps {
  onShare: (subject: Subject, level: Level) => void
}

export function ShareAdder({ onShare }: ShareAdderProps) {
  const [picked, setPicked] = useState<Picked | null>(null)
  const [level, setLevel] = useState<Level>('view')
  const everyone = picked?.kind === 'everyone'
  return (
    <form
      className="share-adder"
      onSubmit={(event) => {
        event.preventDefault()
        if (picked) {
          onShare(
            picked.kind === 'everyone' ? { kind: 'everyone' } : { kind: picked.kind, id: picked.id },
            everyone ? 'view' : level,
          )
          setPicked(null)
        }
      }}
    >
      <div className="share-adder-who">
        <SubjectPicker
          label="Share with"
          value={picked}
          onChange={setPicked}
          kinds={['user', 'group', 'team', 'everyone']}
        />
      </div>
      {!everyone && <Select aria-label="What they can do" options={LEVELS} value={level} onChange={setLevel} />}
      <Button type="submit" variant="primary" disabled={!picked}>
        Share
      </Button>
    </form>
  )
}
