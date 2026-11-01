import { Select } from './Select.tsx'
import './WatchSelect.css'

// How much of a team someone hears about.
export type WatchLevel = 'participating' | 'active' | 'all'

export const WATCH_LEVELS: { value: WatchLevel; label: string; blurb: string }[] = [
  {
    value: 'participating',
    label: 'Participating and assigned',
    blurb: 'Only ideas you wrote, are asked to review (directly or through a group), or follow.',
  },
  {
    value: 'active',
    label: 'Active ideas',
    blurb: 'Every idea once it’s out of draft, until it’s closed, including the close.',
  },
  { value: 'all', label: 'All ideas', blurb: 'Everything in this team, drafts included.' },
]

export interface WatchSelectProps {
  value: WatchLevel
  onChange: (level: WatchLevel) => void
  label?: string
}

// Your watch level for a team. Anything above the default is highlighted.
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
