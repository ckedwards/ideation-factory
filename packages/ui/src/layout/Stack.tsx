import type { ReactNode } from 'react'
import './Stack.css'

// A step on the spacing scale: --space-1 (0.25rem) to --space-8 (4.5rem)
export type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface StackProps {
  children: ReactNode
  gap?: Space
}

// Things one under another, evenly spaced.
export function Stack({ children, gap = 4 }: StackProps) {
  return (
    <div className="stack" data-gap={gap}>
      {children}
    </div>
  )
}

export interface RowProps {
  children: ReactNode
  gap?: Space
  align?: 'start' | 'center' | 'end' | 'baseline' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'between'
  // onto more lines when there isn't room (the default)
  wrap?: boolean
}

// Things side by side: a toolbar, a set of filters, a button pair.
export function Row({ children, gap = 2, align = 'center', justify = 'start', wrap = true }: RowProps) {
  return (
    <div className="row" data-gap={gap} data-align={align} data-justify={justify} data-wrap={wrap || undefined}>
      {children}
    </div>
  )
}
