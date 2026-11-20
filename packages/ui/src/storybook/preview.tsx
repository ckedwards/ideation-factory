// Storybook's settings for every package with stories (ui's and web's):
// the theme and text size toolbar, a fixed "now", and axe on every story.
// Each package's .storybook/preview.tsx uses these as they are.
import { useEffect } from 'react'
import type { Decorator, Preview } from '@storybook/react-vite'
import '../theme/theme.css'
import { NOW } from '../stories/fixtures.ts'
import { NowProvider } from '../time/RelativeTime.tsx'
import { loadFonts } from '../theme/fonts.ts'

// the typefaces fetched at start, as the app does (fonts.ts)
loadFonts()

// The toolbar's theme and text size go on <html>, where the app sets them, so
// every story is seen as a page would show it.
const withTheme: Decorator = (Story, { globals }) => {
  const theme = String(globals['theme'] ?? 'auto')
  const textSize = String(globals['textSize'] ?? '100%')
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', theme)
    }
    root.style.fontSize = textSize
  }, [theme, textSize])
  return (
    // a fixed "now", so relative times ("5h ago") read the same in every run
    <NowProvider value={() => NOW}>
      <Story />
    </NowProvider>
  )
}

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        title: 'Theme',
        icon: 'contrast',
        items: [
          { value: 'auto', title: 'Auto (follows the system)' },
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
          { value: 'contrast', title: 'High contrast' },
        ],
        dynamicTitle: true,
      },
    },
    textSize: {
      description: 'Text size',
      toolbar: {
        title: 'Text size',
        icon: 'zoom',
        items: [
          { value: '100%', title: 'Text 100%' },
          { value: '125%', title: 'Text 125%' },
          { value: '150%', title: 'Text 150%' },
          { value: '200%', title: 'Text 200%' },
        ],
        dynamicTitle: true,
      },
    },
  },
  // the story tests run once per theme (each package's vitest.config.ts)
  initialGlobals: { theme: import.meta.env['STORYBOOK_THEME'] ?? 'auto', textSize: '100%' },
  parameters: {
    layout: 'padded',
    // the page's own background, not Storybook's, so themes show as they are
    backgrounds: { disable: true },
    controls: { expanded: true },
    // axe runs on every story; a violation fails the story's check, not a warning
    a11y: {
      test: 'error',
      // Base UI's focus guards around an open popup: hidden, empty spans that
      // pass focus straight on into or out of it, never keeping it
      context: { exclude: ['[data-base-ui-focus-guard]'] },
    },
  },
}

export default preview
