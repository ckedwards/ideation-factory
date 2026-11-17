// An idea's pages, as tabs under its bar: its overview and its files, with how
// many files there are. Each is its own address, so these are links, the one
// shown marked. Comparing versions is a way of looking at the files (the
// document's toolbar), so it's under Files, and the tabs are the same for every
// idea. Drawn once, by the idea's frame, so they never move.
import { Link } from '@ideaf/ui'
import './IdeaTabs.css'

export interface IdeaTabsProps {
  /** None, on a page of the idea that isn't one of its tabs (moving it). */
  current: 'overview' | 'files' | null
  overview: string
  files: string
  /** How many files it has, beside Files. */
  fileCount?: number
}

export function IdeaTabs({ current, overview, files, fileCount }: IdeaTabsProps) {
  const tabs = [
    { id: 'overview', label: 'Overview', href: overview, count: undefined },
    { id: 'files', label: 'Files', href: files, count: fileCount },
  ]
  return (
    <nav className="idea-tabs" aria-label="This idea">
      {tabs.map((tab) => (
        <Link key={tab.id} href={tab.href} aria-current={tab.id === current ? 'page' : undefined}>
          {tab.label}
          {tab.count !== undefined && <span className="idea-tabs-count">{tab.count}</span>}
        </Link>
      ))}
    </nav>
  )
}
