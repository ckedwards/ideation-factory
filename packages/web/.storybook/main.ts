// Storybook for the web app's own components: those beside a route (in its
// -components folder) and those several routes share (src/components). The
// building blocks have theirs in @ideaf/ui. It runs on Node: `bun run
// storybook` in this package.
import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs', '@storybook/addon-vitest'],
  core: { disableTelemetry: true },
  // no "Get started" checklist in the sidebar, or its guide page in the menu
  features: { sidebarOnboardingChecklist: false, menuOnboardingChecklist: false },
  // the app's hot reloading port is for its dev server, not Storybook's
  viteFinal: (config) => ({ ...config, server: { ...config.server, hmr: true } }),
}

export default config
