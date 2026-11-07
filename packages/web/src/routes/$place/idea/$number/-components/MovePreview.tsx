// What moving an idea would change, before anything does: where it goes,
// who loses access and who gains it, by name, and the grants after. The old
// team's grant can be kept, and the new team's defaults left out, before
// confirming.
import { Button, type Person, Stack, UserName } from '@ideaf/ui'
import { plural } from '../../../../../plural.ts'
import './MovePreview.css'

export interface Change {
  count: number
  people: Person[]
  everyone: boolean
}

/** A grant the move takes away (keepable) or adds (skippable). */
export interface Adjustable {
  key: string
  label: string
  /** Kept, or (for one it adds) left out. */
  checked: boolean
}

export interface MovePreviewProps {
  from: string
  to: string
  losing: Change
  gaining: Change
  /** Grants it takes away: tick to keep. */
  removed: Adjustable[]
  /** Grants it adds (the new team's defaults): tick to leave out. */
  added: Adjustable[]
  onKeep: (key: string, keep: boolean) => void
  onSkip: (key: string, skip: boolean) => void
  onConfirm: () => void
  moving?: boolean
}

export function MovePreview(props: MovePreviewProps) {
  return (
    <Stack gap={4}>
      <p className="move-route">
        From <b>{props.from}</b> to <b>{props.to}</b>
      </p>
      <ChangeList title="Losing access" change={props.losing} none="Nobody loses access." />
      <ChangeList title="Gaining access" change={props.gaining} none="Nobody new gains access." />
      {props.removed.length > 0 && (
        <fieldset className="move-adjust">
          <legend>Access the move takes away</legend>
          {props.removed.map((r) => (
            <label key={r.key}>
              <input type="checkbox" checked={r.checked} onChange={(e) => props.onKeep(r.key, e.target.checked)} /> Keep{' '}
              {r.label}
            </label>
          ))}
        </fieldset>
      )}
      {props.added.length > 0 && (
        <fieldset className="move-adjust">
          <legend>Access the new team gives its ideas</legend>
          {props.added.map((a) => (
            <label key={a.key}>
              <input type="checkbox" checked={a.checked} onChange={(e) => props.onSkip(a.key, e.target.checked)} />{' '}
              Leave out {a.label}
            </label>
          ))}
        </fieldset>
      )}
      <div>
        <Button variant="primary" onClick={props.onConfirm} disabled={props.moving}>
          {props.moving ? 'Moving…' : `Move it to ${props.to}`}
        </Button>
      </div>
    </Stack>
  )
}

function ChangeList({ title, change, none }: { title: string; change: Change; none: string }) {
  return (
    <section className="move-change" aria-label={title}>
      <h3>{title}</h3>
      {change.everyone ? (
        <p>Everyone on the site.</p>
      ) : change.count === 0 ? (
        <p>{none}</p>
      ) : (
        <>
          <ul>
            {change.people.map((p) => (
              <li key={p.id}>
                <UserName person={p} withAvatar />
              </li>
            ))}
          </ul>
          {change.count > change.people.length && <p>and {plural(change.count - change.people.length, 'other')}</p>}
        </>
      )}
    </section>
  )
}
