import type { ReactNode } from 'react'
import './PageHeader.css'

export interface PageHeaderProps {
  title: ReactNode
  // a line under the title: what the page is for
  sub?: ReactNode
  // above the title: where the page sits ("Teams › Mobile")
  crumbs?: ReactNode
  // buttons and controls, on the right
  actions?: ReactNode
}

export function PageHeader({ title, sub, crumbs, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {crumbs && <nav className="page-header-crumbs">{crumbs}</nav>}
        <h1>{title}</h1>
        {sub && <p className="page-header-sub">{sub}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  )
}
