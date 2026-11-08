// How much of a team you hear about, beside the team's name. It's the app's
// (not ui's) because it knows the levels and what each means; anything above
// the default is highlighted.
import type { WatchLevel } from '@ideaf/api'
import { Select } from '@ideaf/ui'
import './WatchSelect.css'

export type { WatchLevel }

export const WATCH_LEVELS: { value: WatchLevel; label: string; blurb: string }[] = [
  {
    value: 'participating',
    label: 'Participating and assigned',
    blurb: 'Only ideas you wrote, are asked to review (directly or through a group), took part in, or follow.',
  },
  {
    value: 'active',
    label: 'Active ideas',
    blurb: 'Every idea once it’s out of draft, up to and including its close.',
  },
  { value: 'all', label: 'All ideas', blurb: 'Everything in this team, drafts included.' },
]

export interface WatchSelectProps {
  value: WatchLevel
  onChange: (level: WatchLevel) => void
  label?: string
}

export function WatchSelect({ value, onChange, label = 'Notify me about' }: WatchSelectProps) {
  const level = WATCH_LEVELS.find((w) => w.value === value)
  return (
    <label className="watch-select" title={level?.blurb}>
      <span>{label}</span>
      <Select
        size="sm"
        options={WATCH_LEVELS}
        value={value}
        onChange={onChange}
        emphasized={value !== 'participating'}
      />
    </label>
  )
}
