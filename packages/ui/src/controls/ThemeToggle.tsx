import { SegmentedControl, type Segment } from './SegmentedControl.tsx'

// auto follows the system's light or dark setting
export type Theme = 'auto' | 'light' | 'dark' | 'contrast'

const THEMES: Segment<Theme>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'contrast', label: 'High contrast' },
]

export interface ThemeToggleProps {
  value: Theme
  onChange: (theme: Theme) => void
}

// The theme picker. The app applies the choice with applyTheme.
export function ThemeToggle({ value, onChange }: ThemeToggleProps) {
  return <SegmentedControl label="Theme" options={THEMES} value={value} onChange={onChange} />
}

// Sets the theme on <html>, where the tokens read it.
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  if (theme === 'auto') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', theme)
  }
}
