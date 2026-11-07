// The theme someone picked, kept in this browser only.
import { applyTheme, type Theme } from '@ideaf/ui'

const KEY = 'ideaf-theme'
const THEMES: readonly Theme[] = ['auto', 'light', 'dark', 'contrast']

export function savedTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    return THEMES.includes(saved as Theme) ? (saved as Theme) : 'auto'
  } catch {
    return 'auto'
  }
}

export function setTheme(theme: Theme): void {
  applyTheme(theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // not kept (a private window, say): it still applies to this visit
  }
}
