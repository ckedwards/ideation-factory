// An idea's pages, as tabs: its overview, its files, and what changed. Each
// is its own address, so these are links, the one shown marked.
import { Link } from '@ideaf/ui'
import './IdeaTabs.css'

export interface IdeaTabsProps {
  current: 'overview' | 'files' | 'changes'
  overview: string
  files: string
  /** What changed in the latest version; none while there's only one. */
  changes: string | null
}

export function IdeaTabs({ current, overview, files, changes }: IdeaTabsProps) {
  const tabs = [
    { id: 'overview', label: 'Overview', href: overview },
    { id: 'files', label: 'Files', href: files },
    ...(changes ? [{ id: 'changes', label: 'Changes', href: changes }] : []),
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
