// The stories as tests, as in ui: every story renders in headless Chromium,
// its play function runs, and axe checks it, once in each theme.
// `bun run test:stories` here; CI runs it in a job of its own.
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
      plugins: [storybookTest({ configDir })],
      // read by the shared preview (@ideaf/ui/storybook) as the starting theme
      define: { 'import.meta.env.STORYBOOK_THEME': JSON.stringify(theme) },
      test: {
        name: theme,
        isolate: false,
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
