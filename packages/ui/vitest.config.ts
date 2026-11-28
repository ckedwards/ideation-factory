// The stories as tests: every story renders in a real browser (headless
// Chromium), its play function runs, and axe checks it for accessibility, once
// in each theme. `bun run test:stories` here; CI runs it too.
import { fileURLToPath } from 'node:url'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const configDir = fileURLToPath(new URL('.storybook', import.meta.url))
const themes = ['light', 'dark', 'contrast']

export default defineConfig({
  test: {
    projects: themes.map((theme) => ({
      extends: true,
      // a story tagged one-theme (one that checks something no theme changes) runs in the light one only
      plugins: [storybookTest({ configDir, ...(theme === 'light' ? {} : { tags: { exclude: ['one-theme'] } }) })],
      // read by .storybook/preview.tsx as the starting theme
      define: { 'import.meta.env.STORYBOOK_THEME': JSON.stringify(theme) },
      test: {
        name: theme,
        isolate: false,
        // a story's play has 30 s: the heaviest take a few on their own, more with every story running at once
        testTimeout: 30_000,
        browser: {
          enabled: true,
          headless: true,
          provider: playwright(),
          instances: [{ browser: 'chromium' }],
        },
      },
    })),
  },
})
