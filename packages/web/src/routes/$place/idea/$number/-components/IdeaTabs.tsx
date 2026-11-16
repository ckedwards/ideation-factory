// An idea's pages, as tabs: its overview and its files. Each is its own address, so these are links,
// the one shown marked. Comparing versions is a way of looking at the files (the document's toolbar),
// so it's under Files, and the tabs are the same for every idea.
import { Link } from '@ideaf/ui'
import './IdeaTabs.css'

export interface IdeaTabsProps {
  current: 'overview' | 'files'
  overview: string
  files: string
}

export function IdeaTabs({ current, overview, files }: IdeaTabsProps) {
  const tabs = [
    { id: 'overview', label: 'Overview', href: overview },
    { id: 'files', label: 'Files', href: files },
  ]
  return (
    <nav className="idea-tabs" aria-label="This idea">
      {tabs.map((tab) => (
        <Link key={tab.id} href={tab.href} aria-current={tab.id === current ? 'page' : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
