// Storybook: the viewer for every component and story in @ideaf/ui (see
// docs/mvp/architecture-frontend.md, "The component viewer"). It runs on Node,
// started from Bun's scripts: `bun run storybook` in this package.
import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs', '@storybook/addon-vitest'],
  core: { disableTelemetry: true },
}

export default config
