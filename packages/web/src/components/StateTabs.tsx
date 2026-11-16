// Open and Closed over a list of ideas, each with how many there are (the list's own filters applied).
import type { ReactNode } from 'react'
import { Tabs } from '@ideaf/ui'
import type { IdeaState } from '../lists.ts'

export interface StateTabsProps {
  value: IdeaState
  onChange: (state: IdeaState) => void
  /** How many each has; left out until they're known. */
  counts?: { open: number; closed: number } | undefined
  children: ReactNode
}

export function StateTabs({ value, onChange, counts, children }: StateTabsProps) {
  return (
    <Tabs
      label="Open or closed"
      tabs={[
        { id: 'open', label: 'Open', ...(counts ? { count: counts.open } : {}) },
        { id: 'closed', label: 'Closed', ...(counts ? { count: counts.closed } : {}) },
      ]}
      value={value}
      onChange={onChange}
    >
      {children}
    </Tabs>
  )
}
