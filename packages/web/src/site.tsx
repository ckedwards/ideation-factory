// What every page can reach about you and the site, whether or not it shows
// the site's navigation (an idea's pages don't): your account menu's theme and
// signing out. The root provides it.
import { createContext, useContext } from 'react'
import type { Theme } from '@ideaf/ui'

export interface Site {
  theme: Theme
  onThemeChange: (theme: Theme) => void
  onSignOut: () => void
}

const SiteContext = createContext<Site | null>(null)

export const SiteProvider = SiteContext.Provider

export function useSite(): Site {
  const site = useContext(SiteContext)
  if (!site) {
    throw new Error('useSite outside the root')
  }
  return site
}
